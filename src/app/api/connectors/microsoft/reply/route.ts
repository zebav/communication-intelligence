import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { decryptCredential, encryptCredential } from "@/lib/connectors/credential-crypto";
import { microsoftGraphConnector } from "@/lib/connectors/microsoft-graph";
import { microsoftConfig } from "@/lib/connectors/microsoft-oauth";
import { createClient } from "@/lib/supabase/server";

type StoredCredentials = { accessToken: string; refreshToken?: string; tokenType?: string; scope?: string; expiresAt: string };
type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string; scope?: string };
const requestSchema = z.object({ messageId: z.string().uuid(), conversationId: z.string().uuid(), body: z.string().trim().min(1).max(4000) });
const jsonError = (message: string, status = 500) => NextResponse.json({ error: message }, { status });

async function getAccessToken(credentials: StoredCredentials, origin: string) {
  if (new Date(credentials.expiresAt).getTime() > Date.now() + 60_000) return { accessToken: credentials.accessToken, credentials, refreshed: false };
  if (!credentials.refreshToken) throw new Error("reconnect_required");
  const config = microsoftConfig(origin);
  const response = await fetch(`https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: credentials.refreshToken, scope: microsoftGraphConnector.scopes.join(" ") }), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("reconnect_required");
  const tokens = await response.json() as TokenResponse;
  if (!tokens.access_token || !tokens.expires_in) throw new Error("reconnect_required");
  const next = { accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? credentials.refreshToken, tokenType: tokens.token_type ?? credentials.tokenType, scope: tokens.scope ?? credentials.scope, expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString() };
  return { accessToken: tokens.access_token, credentials: next, refreshed: true };
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return jsonError("Invalid request origin.", 403);
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Check the reply and try again.", 400);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Your session has expired. Sign in again.", 401);
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return jsonError("Two-factor authentication is required.", 403);

  const { data: message } = await supabase.from("messages").select("external_message_id").eq("id", parsed.data.messageId).eq("conversation_id", parsed.data.conversationId).eq("owner_id", user.id).eq("source", "email").eq("direction", "in").maybeSingle();
  if (!message?.external_message_id) return jsonError("The Outlook message could not be found.", 404);
  const { data: connection } = await supabase.from("connections").select("id,encrypted_credentials,token_metadata").eq("owner_id", user.id).eq("provider", microsoftGraphConnector.id).eq("status", "connected").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!connection?.encrypted_credentials) return jsonError("Connect Outlook again before sending.", 409);
  const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!encryptionKey) return jsonError("The server encryption key is not configured.");

  try {
    const token = await getAccessToken(decryptCredential<StoredCredentials>(connection.encrypted_credentials, encryptionKey), request.nextUrl.origin);
    if (token.refreshed) await supabase.from("connections").update({ encrypted_credentials: encryptCredential(token.credentials, encryptionKey), token_metadata: { ...(connection.token_metadata as object ?? {}), expires_at: token.credentials.expiresAt }, updated_at: new Date().toISOString() }).eq("id", connection.id).eq("owner_id", user.id);
    const graphResponse = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(message.external_message_id)}/reply`, { method: "POST", headers: { authorization: `Bearer ${token.accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ comment: parsed.data.body }), signal: AbortSignal.timeout(20_000) });
    if (graphResponse.status === 401 || graphResponse.status === 403) return jsonError("Outlook permission is missing. Reconnect Outlook and try again.", 409);
    if (!graphResponse.ok) throw new Error(`graph_${graphResponse.status}`);
    const sentAt = new Date().toISOString();
    await supabase.from("messages").insert({ owner_id: user.id, conversation_id: parsed.data.conversationId, external_message_id: `local-sent-${crypto.randomUUID()}`, direction: "out", source: "email", body_text: parsed.data.body, sent_at: sentAt, processed_at: sentAt, metadata: { provider: microsoftGraphConnector.id, sent_from_suggested_reply: true } });
    await supabase.from("conversations").update({ last_user_message_at: sentAt, updated_at: sentAt }).eq("id", parsed.data.conversationId).eq("owner_id", user.id);
    return NextResponse.json({ success: true, sentAt });
  } catch (error) {
    console.error("Microsoft reply failed", error instanceof Error ? error.message : "unknown");
    return jsonError("The reply could not be sent. Nothing was changed. Try again.");
  }
}
