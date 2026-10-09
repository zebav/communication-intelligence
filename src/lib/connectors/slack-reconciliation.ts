import { createAdminClient } from "@/lib/supabase/admin";
import { decryptCredential } from "@/lib/connectors/credential-crypto";
import { resolveOrCreateChannelPerson } from "@/lib/connectors/person-resolution";
import { analyzeIncomingInstagramMessage } from "@/lib/connectors/instagram-intelligence";

type Credentials = { accessToken?: string; slackUserId?: string; tokenAudience?: "user" | "bot" };
type SlackChannel = { id?: string; name?: string; is_im?: boolean; is_mpim?: boolean; user?: string };
type SlackMessage = { ts?: string; user?: string; text?: string };
type SlackUser = { id?: string; real_name?: string; profile?: { display_name?: string } };
type SlackResponse = { ok?: boolean; error?: string; channels?: SlackChannel[]; messages?: SlackMessage[]; user?: SlackUser };
type FetchedConversation = { channel: SlackChannel; messages: SlackMessage[] };

const MAX_CONVERSATIONS_PER_RUN = 8;
const MAX_MESSAGES_PER_RUN = 36;
const HISTORY_CONCURRENCY = 4;
const PROFILE_CONCURRENCY = 6;

async function slack(token: string, method: string, params: Record<string, string>, timeoutMs = 8_000) {
  const url = new URL(`https://slack.com/api/${method}`); Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.json() as SlackResponse;
  if (!response.ok || !body.ok) throw new Error(`slack_${body.error ?? response.status}`); return body;
}

async function mapWithConcurrency<T, Result>(items: T[], concurrency: number, worker: (item: T) => Promise<Result>) {
  const results: Result[] = [];
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      results.push(await worker(item));
    }
  }));
  return results;
}

/** Bounded, read-only import. It never posts to Slack. */
export async function reconcileSlackConnection(connectionId: string) {
  const db = createAdminClient();
  const { data: connection } = await db.from("connections").select("id,owner_id,account_name,encrypted_credentials,scopes").eq("id", connectionId).eq("provider", "slack").eq("status", "connected").maybeSingle();
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!connection?.encrypted_credentials || !key) throw new Error("slack_credentials_unavailable");
  const credentials = decryptCredential<Credentials>(connection.encrypted_credentials, key);
  if (!credentials.accessToken) throw new Error("slack_credentials_unavailable");
  const accessToken = credentials.accessToken;
  // Older installations used a bot token. It cannot see the owner's own DMs,
  // so it must be replaced by the user token requested by the current OAuth flow.
  if (credentials.tokenAudience !== "user") throw new Error("slack_reconnect_required");
  const grantedScopes = new Set(Array.isArray(connection.scopes) ? connection.scopes.filter((value): value is string => typeof value === "string") : []);
  const types = [
    grantedScopes.has("im:read") && "im",
    grantedScopes.has("mpim:read") && "mpim",
    grantedScopes.has("channels:read") && "public_channel",
    grantedScopes.has("groups:read") && "private_channel",
  ].filter(Boolean).join(",");
  if (!types) throw new Error("slack_reconnect_required");
  // users.conversations returns the conversations the authorised person is a
  // member of, rather than the bot's view of the workspace.
  const listed = await slack(accessToken, "users.conversations", { types, exclude_archived: "true", limit: "100" }, 10_000);
  let imported = 0;
  const requestedChannels = (listed.channels ?? []).slice(0, MAX_CONVERSATIONS_PER_RUN);
  const histories = await mapWithConcurrency(requestedChannels, HISTORY_CONCURRENCY, async (channel): Promise<FetchedConversation | null> => {
    const channelId = channel.id ?? "";
    if (!channelId) return null;
    try {
      const history = await slack(accessToken, "conversations.history", { channel: channelId, limit: "20" });
      return { channel, messages: history.messages ?? [] };
    } catch {
      // A shared or archived conversation can be unavailable independently of
      // the rest of the workspace. Keep importing every other channel, but do
      // not present a completely unreadable workspace as a healthy import.
      return null;
    }
  });
  const fetched = histories.filter((history): history is FetchedConversation => history !== null);
  const readableConversations = fetched.length;
  const unavailableConversations = requestedChannels.length - readableConversations;
  if (requestedChannels.length > 0 && readableConversations === 0) {
    throw new Error("slack_history_unavailable");
  }

  const candidates = fetched.flatMap(({ channel, messages }) => messages.map((message) => ({ channel, message })))
    .filter(({ message }) => {
      const senderId = message.user ?? "";
      return Boolean(senderId && message.text?.trim() && message.ts && senderId !== credentials.slackUserId);
    })
    .slice(0, MAX_MESSAGES_PER_RUN);
  const displayNames = new Map<string, string>();
  const senderIds = [...new Set(candidates.map(({ message }) => message.user!).filter(Boolean))];
  const resolvedNames = await mapWithConcurrency(senderIds, PROFILE_CONCURRENCY, async (senderId) => {
    try {
      const user = await slack(accessToken, "users.info", { user: senderId }, 5_000);
      return [senderId, user.user?.profile?.display_name?.trim() || user.user?.real_name?.trim()] as const;
    } catch {
      return [senderId, undefined] as const;
    }
  });
  for (const [senderId, name] of resolvedNames) if (name) displayNames.set(senderId, name);
  const analyses: Array<{ ownerId: string; conversationId: string; messageId: string; source: "slack" }> = [];
  for (const { channel, message } of candidates) {
      const channelId = channel.id ?? "";
      const senderId = message.user ?? ""; const text = message.text?.trim() ?? ""; const timestamp = message.ts ?? "";
      const displayName = displayNames.get(senderId) ?? `Slack contact ${senderId.slice(-6)}`;
      const sentAt = new Date(Number(timestamp.split(".")[0]) * 1000).toISOString();
      const channelMode = channel.is_im || channel.is_mpim ? "private" : "work";
      const mentionedOwner = Boolean(credentials.slackUserId && text.includes(`<@${credentials.slackUserId}>`));
      const person = await resolveOrCreateChannelPerson({ database: db, ownerId: connection.owner_id, source: "slack", externalIdentifier: `slack:${senderId}`, displayName, connectionId: connection.id, contactAt: sentAt, identityMetadata: { slack_user_id: senderId } });
      const conversationKey = `slack:${connection.id}:${channelId}`;
      const title = channel.is_im ? `Slack · ${displayName}` : channel.is_mpim ? "Slack · gruppmeddelande" : `Slack · #${channel.name ?? "kanal"}`;
      const { data: existing } = await db.from("conversations").select("id").eq("owner_id", connection.owner_id).eq("source", "slack").eq("external_conversation_id", conversationKey).maybeSingle();
      const values = { owner_id: connection.owner_id, person_id: person.personId, connection_id: connection.id, source: "slack", external_conversation_id: conversationKey, title, conversation_type: channel.is_im ? "direct_message" : "group", last_message_at: sentAt, last_other_message_at: sentAt, updated_at: new Date().toISOString() };
      const savedConversation = existing?.id ? await db.from("conversations").update(values).eq("id", existing.id).select("id").single() : await db.from("conversations").insert(values).select("id").single();
      if (savedConversation.error || !savedConversation.data) throw savedConversation.error ?? new Error("slack_conversation_save_failed");
      const { data: saved, error } = await db.from("messages").upsert({ owner_id: connection.owner_id, conversation_id: savedConversation.data.id, external_message_id: `slack:${channelId}:${timestamp}`, direction: "in", sender_identity_id: person.identityId, source: "slack", body_text: text, sent_at: sentAt, classification: mentionedOwner ? "Action Required" : channelMode === "work" ? "Information Only" : "Personal", importance_score: mentionedOwner ? 9 : channelMode === "private" ? 6 : 4, metadata: { provider: "slack", connection_id: connection.id, channel_id: channelId, channel_name: channel.name ?? null, slack_channel_mode: channelMode, slack_mentioned_owner: mentionedOwner }, processed_at: null }, { onConflict: "owner_id,source,external_message_id", ignoreDuplicates: true }).select("id").maybeSingle();
      if (error) throw error; if (saved) { imported += 1; analyses.push({ ownerId: connection.owner_id, conversationId: savedConversation.data.id, messageId: saved.id, source: "slack" }); }
  }
  await Promise.allSettled(analyses.slice(0, 3).map(analyzeIncomingInstagramMessage));
  await db.from("connections").update({
    health_status: unavailableConversations > 0 ? "degraded" : "healthy",
    last_sync_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", connection.id);
  return { imported, readableConversations, unavailableConversations };
}
