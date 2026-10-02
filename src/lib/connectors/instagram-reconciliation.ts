import { createAdminClient } from "@/lib/supabase/admin";
import { decryptCredential } from "@/lib/connectors/credential-crypto";
import { instagramConnector } from "@/lib/connectors/instagram";
import { instagramConversationsUrl } from "@/lib/connectors/instagram-api";
import { resolveOrCreateChannelPerson } from "@/lib/connectors/person-resolution";

type GraphIdentity = { id?: string };
type GraphMessage = { id?: string; message?: string; created_time?: string; from?: GraphIdentity; to?: { data?: GraphIdentity[] } | GraphIdentity[] };
type GraphConversation = { messages?: { data?: GraphMessage[] } };
type Credentials = { accessToken?: string };
const MAX_RECONCILIATION_MESSAGES = 6;

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function participantFromTo(value: GraphMessage["to"]) { const ids = Array.isArray(value) ? value : value?.data; return ids?.map((item) => item.id ?? "").find(Boolean) ?? ""; }

/** Bounded repair path for missed Instagram webhooks. It never sends messages. */
export async function reconcileInstagramConnection(connectionId: string) {
  const database = createAdminClient();
  const { data: connection, error } = await database.from("connections").select("id,owner_id,account_name,account_identifier,encrypted_credentials,token_metadata").eq("id", connectionId).eq("provider", instagramConnector.id).eq("status", "connected").maybeSingle();
  if (error || !connection) throw new Error("instagram_connection_not_found");
  const accountId = String(record(connection.token_metadata).instagram_user_id ?? "");
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!key || !connection.encrypted_credentials || !accountId) throw new Error("instagram_credentials_unavailable");
  const accessToken = decryptCredential<Credentials>(connection.encrypted_credentials, key).accessToken;
  if (!accessToken) throw new Error("instagram_credentials_unavailable");
  const response = await fetch(instagramConversationsUrl(accountId), { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`instagram_reconciliation_${response.status}`);
  const payload = await response.json() as { data?: GraphConversation[] };
  let imported = 0;
  // Meta can return many nested messages. Reconciliation is intentionally a
  // bounded webhook repair pass; the dedicated intelligence worker will pick
  // up imported messages in its own small batch immediately afterwards.
  const items = (payload.data ?? []).flatMap((thread) => thread.messages?.data ?? []).slice(0, MAX_RECONCILIATION_MESSAGES);
  for (const item of items) {
    const externalId = item.id?.trim() ?? "", sender = item.from?.id?.trim() ?? "";
    const direction = sender === accountId ? "out" as const : "in" as const;
    const participantId = direction === "in" ? sender : participantFromTo(item.to);
    const body = item.message?.trim() ?? "";
    if (!externalId || !participantId || participantId === accountId || !body) continue;
    const sentAt = item.created_time && !Number.isNaN(Date.parse(item.created_time)) ? new Date(item.created_time).toISOString() : new Date().toISOString();
    // Profile lookups have a separate endpoint and were the source of the
    // production timeout. Webhooks and existing identities already preserve a
    // real name; missed-webhook repair must prefer a fast, safe fallback over
    // delaying every new message.
    const displayName = `Instagram contact ${participantId.slice(-6)}`;
    const person = await resolveOrCreateChannelPerson({ database, ownerId: connection.owner_id, source: "instagram", externalIdentifier: `instagram:${participantId}`, displayName, connectionId: connection.id, confidence: 0.65, contactAt: sentAt, identityMetadata: { instagram_scoped_id: participantId, discovered_by: "reconciliation" } });
    const conversationKey = `instagram:${connection.id}:${participantId}`;
    const { data: existing } = await database.from("conversations").select("id").eq("owner_id", connection.owner_id).eq("source", "instagram").eq("external_conversation_id", conversationKey).maybeSingle();
    const values: Record<string, unknown> = { owner_id: connection.owner_id, person_id: person.personId, connection_id: connection.id, source: "instagram", external_conversation_id: conversationKey, title: `Instagram · ${connection.account_identifier ?? connection.account_name ?? "account"}`, conversation_type: "direct_message", last_message_at: sentAt, ...(direction === "in" ? { last_other_message_at: sentAt } : { last_user_message_at: sentAt }), updated_at: new Date().toISOString() };
    const conversation = existing?.id ? await database.from("conversations").update(values).eq("id", existing.id).select("id").single() : await database.from("conversations").insert(values).select("id").single();
    if (conversation.error || !conversation.data) throw conversation.error ?? new Error("instagram_conversation_save_failed");
    const { data: saved, error: saveError } = await database.from("messages").upsert({ owner_id: connection.owner_id, conversation_id: conversation.data.id, external_message_id: externalId, direction, sender_identity_id: direction === "in" ? person.identityId : null, source: "instagram", body_text: body, sent_at: sentAt, attachment_count: 0, metadata: { provider: instagramConnector.id, connection_id: connection.id, reconciliation: true }, processed_at: null }, { onConflict: "owner_id,source,external_message_id", ignoreDuplicates: true }).select("id").maybeSingle();
    if (saveError) throw saveError;
    if (saved) imported += 1;
  }
  await database.from("connections").update({ health_status: "healthy", last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", connection.id);
  return { imported, scanned: items.length };
}
