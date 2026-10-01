import { createAdminClient } from "@/lib/supabase/admin";
import { decryptCredential } from "@/lib/connectors/credential-crypto";
import { resolveOrCreateChannelPerson } from "@/lib/connectors/person-resolution";
import { analyzeIncomingInstagramMessage } from "@/lib/connectors/instagram-intelligence";

type Credentials = { accessToken?: string; slackUserId?: string };
type SlackChannel = { id?: string; name?: string; is_im?: boolean; is_mpim?: boolean; user?: string };
type SlackMessage = { ts?: string; user?: string; text?: string };
type SlackUser = { id?: string; real_name?: string; profile?: { display_name?: string } };
async function slack(token: string, method: string, params: Record<string, string>) {
  const url = new URL(`https://slack.com/api/${method}`); Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  const body = await response.json() as { ok?: boolean; error?: string; channels?: SlackChannel[]; messages?: SlackMessage[]; user?: SlackUser };
  if (!response.ok || !body.ok) throw new Error(`slack_${body.error ?? response.status}`); return body;
}

/** Bounded, read-only import. It never posts to Slack. */
export async function reconcileSlackConnection(connectionId: string) {
  const db = createAdminClient();
  const { data: connection } = await db.from("connections").select("id,owner_id,account_name,encrypted_credentials").eq("id", connectionId).eq("provider", "slack").eq("status", "connected").maybeSingle();
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!connection?.encrypted_credentials || !key) throw new Error("slack_credentials_unavailable");
  const credentials = decryptCredential<Credentials>(connection.encrypted_credentials, key); if (!credentials.accessToken) throw new Error("slack_credentials_unavailable");
  // Import DMs first, then every readable public/private shared channel. A
  // workspace commonly has no relevant public channels, so omitting private
  // and group DMs made an apparently healthy connection look empty.
  const listed = await slack(credentials.accessToken, "conversations.list", { types: "im,mpim,public_channel,private_channel", exclude_archived: "true", limit: "100" });
  let imported = 0;
  const displayNames = new Map<string, string>();
  const analyses: Array<{ ownerId: string; conversationId: string; messageId: string; source: "slack" }> = [];
  for (const channel of (listed.channels ?? []).slice(0, 30)) {
    const channelId = channel.id ?? ""; if (!channelId) continue;
    const history = await slack(credentials.accessToken, "conversations.history", { channel: channelId, limit: "30" });
    for (const message of history.messages ?? []) {
      const senderId = message.user ?? ""; const text = message.text?.trim() ?? ""; const timestamp = message.ts ?? "";
      if (!senderId || !text || !timestamp || senderId === credentials.slackUserId) continue;
      let displayName = displayNames.get(senderId) ?? `Slack contact ${senderId.slice(-6)}`;
      if (!displayNames.has(senderId)) {
        try { const user = await slack(credentials.accessToken, "users.info", { user: senderId }); displayName = user.user?.profile?.display_name?.trim() || user.user?.real_name?.trim() || displayName; } catch { /* Keep the message even if profile lookup is unavailable. */ }
        displayNames.set(senderId, displayName);
      }
      const sentAt = new Date(Number(timestamp.split(".")[0]) * 1000).toISOString();
      const person = await resolveOrCreateChannelPerson({ database: db, ownerId: connection.owner_id, source: "slack", externalIdentifier: `slack:${senderId}`, displayName, connectionId: connection.id, contactAt: sentAt, identityMetadata: { slack_user_id: senderId } });
      const conversationKey = `slack:${connection.id}:${channelId}`;
      const title = channel.is_im ? `Slack · ${displayName}` : channel.is_mpim ? "Slack · gruppmeddelande" : `Slack · #${channel.name ?? "kanal"}`;
      const { data: existing } = await db.from("conversations").select("id").eq("owner_id", connection.owner_id).eq("source", "slack").eq("external_conversation_id", conversationKey).maybeSingle();
      const values = { owner_id: connection.owner_id, person_id: person.personId, connection_id: connection.id, source: "slack", external_conversation_id: conversationKey, title, conversation_type: channel.is_im ? "direct_message" : "group", last_message_at: sentAt, last_other_message_at: sentAt, updated_at: new Date().toISOString() };
      const savedConversation = existing?.id ? await db.from("conversations").update(values).eq("id", existing.id).select("id").single() : await db.from("conversations").insert(values).select("id").single();
      if (savedConversation.error || !savedConversation.data) throw savedConversation.error ?? new Error("slack_conversation_save_failed");
      const { data: saved, error } = await db.from("messages").upsert({ owner_id: connection.owner_id, conversation_id: savedConversation.data.id, external_message_id: `slack:${channelId}:${timestamp}`, direction: "in", sender_identity_id: person.identityId, source: "slack", body_text: text, sent_at: sentAt, metadata: { provider: "slack", connection_id: connection.id, channel_id: channelId, channel_name: channel.name ?? null }, processed_at: null }, { onConflict: "owner_id,source,external_message_id", ignoreDuplicates: true }).select("id").maybeSingle();
      if (error) throw error; if (saved) { imported += 1; analyses.push({ ownerId: connection.owner_id, conversationId: savedConversation.data.id, messageId: saved.id, source: "slack" }); }
    }
  }
  await Promise.allSettled(analyses.slice(0, 3).map(analyzeIncomingInstagramMessage));
  await db.from("connections").update({ health_status: "healthy", last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", connection.id);
  return { imported };
}
