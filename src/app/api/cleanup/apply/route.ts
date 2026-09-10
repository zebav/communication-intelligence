import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { decryptCredential, encryptCredential } from "@/lib/connectors/credential-crypto";
import { microsoftGraphConnector } from "@/lib/connectors/microsoft-graph";
import { microsoftConfig } from "@/lib/connectors/microsoft-oauth";
import { googleGmailConnector } from "@/lib/connectors/google-gmail";
import { googleConfig } from "@/lib/connectors/google-oauth";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

type StoredCredentials = { accessToken: string; refreshToken?: string; tokenType?: string; scope?: string; expiresAt: string };
const requestSchema = z.object({ messageIds: z.array(z.string().uuid()).min(1).max(50), action: z.enum(["archive", "mark_read", "move_to_junk"]) });

function jsonError(message: string, status = 500) { return NextResponse.json({ error: message }, { status }); }

async function microsoftAccessToken(credentials: StoredCredentials, origin: string) {
  if (new Date(credentials.expiresAt).getTime() > Date.now() + 60_000) return { token: credentials.accessToken, credentials, refreshed: false };
  if (!credentials.refreshToken) throw new Error("reconnect_required");
  const config = microsoftConfig(origin);
  const response = await fetch(`https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: credentials.refreshToken, scope: microsoftGraphConnector.scopes.join(" ") }), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("reconnect_required");
  const result = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string; scope?: string };
  if (!result.access_token || !result.expires_in) throw new Error("reconnect_required");
  const next = { ...credentials, accessToken: result.access_token, refreshToken: result.refresh_token ?? credentials.refreshToken, tokenType: result.token_type ?? credentials.tokenType, scope: result.scope ?? credentials.scope, expiresAt: new Date(Date.now() + result.expires_in * 1000).toISOString() };
  return { token: result.access_token, credentials: next, refreshed: true };
}


async function googleAccessToken(credentials: StoredCredentials, origin: string) {
  if (new Date(credentials.expiresAt).getTime() > Date.now() + 60_000) return { token: credentials.accessToken, credentials, refreshed: false };
  if (!credentials.refreshToken) throw new Error("reconnect_required");
  const config = googleConfig(origin);
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: credentials.refreshToken }), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("reconnect_required");
  const result = await response.json() as { access_token?: string; expires_in?: number; token_type?: string; scope?: string };
  if (!result.access_token || !result.expires_in) throw new Error("reconnect_required");
  const next = { ...credentials, accessToken: result.access_token, tokenType: result.token_type ?? credentials.tokenType, scope: result.scope ?? credentials.scope, expiresAt: new Date(Date.now() + result.expires_in * 1000).toISOString() };
  return { token: result.access_token, credentials: next, refreshed: true };
}

function gmailMessageId(externalMessageId: string) {
  return externalMessageId.startsWith("gmail:") ? externalMessageId.split(":").at(-1) ?? "" : externalMessageId;
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return jsonError("Invalid request origin.", 403);
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Choose between 1 and 50 messages and a supported action.", 400);
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) return jsonError("Your session has expired. Sign in again.", 401);
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return jsonError("Two-factor authentication is required.", 403);
  const { data: messages } = await database.from("messages").select("id,external_message_id,conversation_id,metadata").eq("owner_id", user.id).eq("source", "email").eq("direction", "in").in("id", parsed.data.messageIds);
  if (!messages?.length) return jsonError("The selected messages could not be found.", 404);
  const conversationIds = [...new Set(messages.map((message) => message.conversation_id))];
  const { data: conversations } = await database.from("conversations").select("id,connection_id").eq("owner_id", user.id).in("id", conversationIds);
  const connectionByConversation = new Map((conversations ?? []).map((conversation) => [conversation.id, conversation.connection_id]));
  const connectionIds = [...new Set(messages.flatMap((message) => connectionByConversation.get(message.conversation_id) ? [connectionByConversation.get(message.conversation_id)!] : []))];
  const { data: connections } = connectionIds.length ? await database.from("connections").select("id,provider,account_name,account_identifier,encrypted_credentials,token_metadata").eq("owner_id", user.id).eq("status", "connected").in("id", connectionIds) : { data: [] };
  const connectionMap = new Map((connections ?? []).map((connection) => [connection.id, connection]));
  const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!encryptionKey) return jsonError("The server encryption key is not configured.");
  let completed = 0; const failed: string[] = [];
  for (const connectionId of connectionIds) {
    const connection = connectionMap.get(connectionId);
    const selected = messages.filter((message) => connectionByConversation.get(message.conversation_id) === connectionId);
    if (!connection?.encrypted_credentials || !["microsoft-graph", "gmail"].includes(connection.provider)) { failed.push(`${connection?.account_name || connection?.account_identifier || "Unknown account"}: cleanup action is not available`); continue; }
    try {
      const stored = decryptCredential<StoredCredentials>(connection.encrypted_credentials, encryptionKey);
      if (connection.provider === "gmail" && !String(stored.scope ?? "").split(" ").includes(googleGmailConnector.scopes.at(-1)!)) throw new Error("reconnect_required");
      const authorized = connection.provider === "gmail" ? await googleAccessToken(stored, request.nextUrl.origin) : await microsoftAccessToken(stored, request.nextUrl.origin);
      if (authorized.refreshed) await database.from("connections").update({ encrypted_credentials: encryptCredential(authorized.credentials, encryptionKey), token_metadata: { ...(connection.token_metadata as object ?? {}), expires_at: authorized.credentials.expiresAt }, updated_at: new Date().toISOString() }).eq("id", connection.id).eq("owner_id", user.id);
      for (const message of selected) {
        let response: Response;
        if (connection.provider === "gmail") {
          const labelChanges = parsed.data.action === "archive" ? { removeLabelIds: ["INBOX"] } : parsed.data.action === "mark_read" ? { removeLabelIds: ["UNREAD"] } : { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] };
          response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(gmailMessageId(message.external_message_id))}/modify`, { method: "POST", headers: { authorization: `Bearer ${authorized.token}`, "content-type": "application/json" }, body: JSON.stringify(labelChanges), signal: AbortSignal.timeout(15_000) });
        } else {
          const url = `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(message.external_message_id)}`;
          response = parsed.data.action === "mark_read"
            ? await fetch(url, { method: "PATCH", headers: { authorization: `Bearer ${authorized.token}`, "content-type": "application/json" }, body: JSON.stringify({ isRead: true }), signal: AbortSignal.timeout(15_000) })
            : await fetch(`${url}/move`, { method: "POST", headers: { authorization: `Bearer ${authorized.token}`, "content-type": "application/json" }, body: JSON.stringify({ destinationId: parsed.data.action === "archive" ? "archive" : "junkemail" }), signal: AbortSignal.timeout(15_000) });
        }
        if (!response.ok) { failed.push(`${connection.account_name || connection.account_identifier}: ${message.id}`); continue; }
        const metadata = message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata) ? message.metadata as Record<string, unknown> : {};
        await database.from("messages").update({ metadata: { ...metadata, is_read: parsed.data.action === "mark_read" ? true : metadata.is_read, cleanup_action: parsed.data.action, cleanup_at: new Date().toISOString() } }).eq("id", message.id).eq("owner_id", user.id);
        completed += 1;
      }
    } catch { failed.push(`${connection.account_name || connection.account_identifier}: reconnect required`); }
  }
  await database.from("audit_logs").insert({ owner_id: user.id, actor_id: user.id, action: `cleanup.${parsed.data.action}`, object_type: "messages", source: "email", actor_type: "user", new_value: { requested: messages.length, completed, failed: failed.length, permanent_delete: false } });
  return NextResponse.json({ completed, failed, message: `${completed} message${completed === 1 ? "" : "s"} updated. Nothing was permanently deleted.` });
}
