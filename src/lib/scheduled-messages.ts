import "server-only";
import { decryptCredential, encryptCredential } from "@/lib/connectors/credential-crypto";
import { microsoftConfig } from "@/lib/connectors/microsoft-oauth";
import { microsoftGraphConnector } from "@/lib/connectors/microsoft-graph";
import { instagramConnector } from "@/lib/connectors/instagram";
import { instagramMessagesUrl, instagramSendBody } from "@/lib/connectors/instagram-api";
import { whatsappConnector } from "@/lib/connectors/whatsapp";
import { activeWhatsAppProvider } from "@/lib/connectors/whatsapp-provider";
import { assertWhatsAppReplyWindow, sendWhatsAppText } from "@/lib/connectors/whatsapp-send";
import type { createAdminClient } from "@/lib/supabase/admin";

type Database = ReturnType<typeof createAdminClient>;
type Credentials = { accessToken: string; refreshToken?: string; tokenType?: string; scope?: string; expiresAt: string };
type Scheduled = { id: string; owner_id: string; conversation_id: string; source_message_id: string | null; source: "email" | "instagram" | "whatsapp"; body_text: string; expected_connection_id: string | null; expected_recipient: string | null };

function metadata(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
async function microsoftAccessToken(credentials: Credentials, origin: string) {
  if (Date.parse(credentials.expiresAt) > Date.now() + 60_000) return { accessToken: credentials.accessToken, credentials, refreshed: false };
  if (!credentials.refreshToken) throw new Error("reconnect_required");
  const config = microsoftConfig(origin);
  const response = await fetch(`https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: credentials.refreshToken, scope: microsoftGraphConnector.scopes.join(" ") }), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("reconnect_required");
  const tokens = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string; scope?: string };
  if (!tokens.access_token || !tokens.expires_in) throw new Error("reconnect_required");
  const next = { accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? credentials.refreshToken, tokenType: tokens.token_type ?? credentials.tokenType, scope: tokens.scope ?? credentials.scope, expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString() };
  return { accessToken: next.accessToken, credentials: next, refreshed: true };
}

/** Executes exactly one previously approved send. Throwing means no automatic retry. */
export async function dispatchScheduledMessage(db: Database, item: Scheduled, origin: string) {
  const { data: conversation } = await db.from("conversations").select("id,connection_id,external_conversation_id").eq("id", item.conversation_id).eq("owner_id", item.owner_id).eq("source", item.source).maybeSingle();
  if (!conversation?.connection_id || (item.expected_connection_id && conversation.connection_id !== item.expected_connection_id)) throw new Error("account_changed");
  const { data: sourceMessage } = item.source_message_id ? await db.from("messages").select("id,external_message_id,sender_identity_id").eq("id", item.source_message_id).eq("owner_id", item.owner_id).eq("conversation_id", conversation.id).eq("direction", "in").maybeSingle() : { data: null };
  if (!sourceMessage?.external_message_id) throw new Error("original_message_missing");
  const { data: connection } = await db.from("connections").select("id,account_identifier,encrypted_credentials,token_metadata").eq("id", conversation.connection_id).eq("owner_id", item.owner_id).eq("status", "connected").maybeSingle();
  if (!connection) throw new Error("reconnect_required");
  const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!encryptionKey && item.source !== "whatsapp") throw new Error("server_configuration_missing");
  const now = new Date().toISOString();
  let externalId = "";
  let provider = "";
  if (item.source === "email") {
    if (!connection.encrypted_credentials) throw new Error("reconnect_required");
    const token = await microsoftAccessToken(decryptCredential<Credentials>(connection.encrypted_credentials, encryptionKey!), origin);
    if (item.expected_recipient) {
      const original = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(sourceMessage.external_message_id)}?$select=from,replyTo`, { headers: { authorization: `Bearer ${token.accessToken}` }, signal: AbortSignal.timeout(15_000) });
      const originalValue = await original.json().catch(() => null) as { from?: { emailAddress?: { address?: string } }; replyTo?: { emailAddress?: { address?: string } }[] } | null;
      const candidates = [originalValue?.from?.emailAddress?.address, ...(originalValue?.replyTo ?? []).map((entry) => entry.emailAddress?.address)].filter(Boolean).map((value) => String(value).toLowerCase());
      if (!original.ok || !candidates.includes(item.expected_recipient.toLowerCase())) throw new Error("recipient_changed");
    }
    if (token.refreshed) await db.from("connections").update({ encrypted_credentials: encryptCredential(token.credentials, encryptionKey!), token_metadata: { ...metadata(connection.token_metadata), expires_at: token.credentials.expiresAt }, updated_at: now }).eq("id", connection.id).eq("owner_id", item.owner_id);
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(sourceMessage.external_message_id)}/reply`, { method: "POST", headers: { authorization: `Bearer ${token.accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ comment: item.body_text }), signal: AbortSignal.timeout(20_000) });
    if (response.status === 401 || response.status === 403) throw new Error("reconnect_required");
    if (!response.ok) throw new Error("provider_send_failed");
    externalId = `scheduled-outlook-${item.id}`; provider = microsoftGraphConnector.id;
  } else if (item.source === "instagram") {
    if (!connection.encrypted_credentials) throw new Error("reconnect_required");
    const participant = conversation.external_conversation_id?.split(":").at(-1) ?? "";
    if (!participant || (item.expected_recipient && participant !== item.expected_recipient)) throw new Error("recipient_changed");
    const accountId = String(metadata(connection.token_metadata).instagram_user_id ?? "");
    const credentials = decryptCredential<Credentials>(connection.encrypted_credentials, encryptionKey!);
    if (!credentials.accessToken || Date.parse(credentials.expiresAt) <= Date.now()) throw new Error("reconnect_required");
    const response = await fetch(instagramMessagesUrl(accountId), { method: "POST", headers: { authorization: `Bearer ${credentials.accessToken}`, "content-type": "application/json" }, body: JSON.stringify(instagramSendBody(participant, item.body_text)), signal: AbortSignal.timeout(20_000) });
    if (response.status === 401 || response.status === 403) throw new Error("reconnect_required");
    if (!response.ok) throw new Error("provider_send_failed");
    externalId = (await response.json().catch(() => ({})) as { message_id?: string }).message_id ?? `scheduled-instagram-${item.id}`; provider = instagramConnector.id;
  } else {
    const participant = conversation.external_conversation_id?.split(":").at(-1) ?? "";
    if (!participant || (item.expected_recipient && participant !== item.expected_recipient)) throw new Error("recipient_changed");
    const { data: latestInbound } = await db.from("messages").select("sent_at").eq("owner_id", item.owner_id).eq("conversation_id", conversation.id).eq("direction", "in").order("sent_at", { ascending: false }).limit(1).maybeSingle();
    assertWhatsAppReplyWindow(latestInbound?.sent_at ?? null);
    const providerId = activeWhatsAppProvider();
    const credential = providerId === "ycloud" ? process.env.YCLOUD_API_KEY?.trim() ?? "" : connection.encrypted_credentials && encryptionKey ? decryptCredential<{ accessToken?: string }>(connection.encrypted_credentials, encryptionKey).accessToken ?? "" : "";
    if (!credential) throw new Error("reconnect_required");
    const result = await sendWhatsAppText({ provider: providerId, from: connection.account_identifier ?? "", to: participant, phoneNumberId: String(metadata(connection.token_metadata).phone_number_id ?? ""), body: item.body_text, credential });
    externalId = result.externalId; provider = `${whatsappConnector.id}:${providerId}`;
  }
  const { data: sent, error: persistError } = await db.from("messages").upsert({ owner_id: item.owner_id, conversation_id: conversation.id, external_message_id: externalId, direction: "out", source: item.source, body_text: item.body_text, sent_at: now, processed_at: now, metadata: { provider, scheduled_message_id: item.id, sent_with_owner_approval: true, delivery_status: "accepted" } }, { onConflict: "owner_id,source,external_message_id", ignoreDuplicates: true }).select("id").maybeSingle();
  if (persistError) throw new Error("local_persistence_failed_after_provider_acceptance");
  await db.from("conversations").update({ last_message_at: now, last_user_message_at: now, updated_at: now }).eq("id", conversation.id).eq("owner_id", item.owner_id);
  await db.from("audit_logs").insert({ owner_id: item.owner_id, actor_id: item.owner_id, action: "message.sent", object_type: "scheduled_message", object_id: item.id, source: item.source, actor_type: "user", new_value: { provider, scheduled: true, external_message_id: externalId, sent_at: now } });
  return { sentMessageId: sent?.id ?? null, sentAt: now, provider };
}
