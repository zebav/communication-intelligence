import { createAdminClient } from "@/lib/supabase/admin";
import { decryptCredential } from "@/lib/connectors/credential-crypto";
import { instagramConnector } from "@/lib/connectors/instagram";
import { instagramConversationsUrl, instagramUserProfileUrl } from "@/lib/connectors/instagram-api";
import { instagramProfileLookupMetadata, shouldEnrichInstagramProfile } from "@/lib/connectors/instagram-profile-enrichment";
import { resolveOrCreateChannelPerson } from "@/lib/connectors/person-resolution";

type GraphIdentity = { id?: string };
type GraphMessage = { id?: string; message?: string; created_time?: string; from?: GraphIdentity; to?: { data?: GraphIdentity[] } | GraphIdentity[] };
type GraphConversation = { messages?: { data?: GraphMessage[] } };
type Credentials = { accessToken?: string };
const MAX_RECONCILIATION_MESSAGES = 6;
const MAX_PROFILE_LOOKUPS_PER_PASS = 1;

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function participantFromTo(value: GraphMessage["to"]) { const ids = Array.isArray(value) ? value : value?.data; return ids?.map((item) => item.id ?? "").find(Boolean) ?? ""; }
function participantFromIdentity(value: string) { return value.replace(/^instagram:/, "").trim(); }

async function enrichOneHistoricalProfile(input: {
  database: ReturnType<typeof createAdminClient>;
  ownerId: string;
  connectionId: string;
  accessToken: string;
}) {
  const { data: identities, error } = await input.database
    .from("identities")
    .select("id,person_id,external_identifier,username,metadata")
    .eq("owner_id", input.ownerId)
    .eq("source", "instagram")
    .is("username", null)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) throw error;

  const identity = (identities ?? []).find((candidate) => {
    const metadata = record(candidate.metadata);
    return metadata.connection_id === input.connectionId && shouldEnrichInstagramProfile(candidate);
  });
  if (!identity) return { lookedUp: 0, resolved: 0 };

  const participantId = participantFromIdentity(identity.external_identifier);
  if (!participantId) return { lookedUp: 0, resolved: 0 };

  let profile: { name?: string; username?: string } | null = null;
  try {
    const response = await fetch(instagramUserProfileUrl(participantId), {
      headers: { authorization: `Bearer ${input.accessToken}` },
      signal: AbortSignal.timeout(4_000),
    });
    if (response.ok) {
      const candidate = await response.json() as { name?: string; username?: string };
      if (candidate.name?.trim() || candidate.username?.trim()) profile = candidate;
    }
  } catch {
    // Profile enrichment never blocks communication delivery. Record a bounded
    // retry window below so this one historical identity cannot consume every
    // scheduled pass when Meta is temporarily unavailable.
  }

  const lookupMetadata = instagramProfileLookupMetadata(Date.now(), Boolean(profile));
  await resolveOrCreateChannelPerson({
    database: input.database,
    ownerId: input.ownerId,
    source: "instagram",
    externalIdentifier: identity.external_identifier,
    preferredPersonId: identity.person_id,
    displayName: profile?.name?.trim() || null,
    username: profile?.username?.trim() || null,
    connectionId: input.connectionId,
    confidence: profile ? 0.8 : 0.65,
    identityMetadata: { ...lookupMetadata, historical_profile_enrichment: true },
  });
  return { lookedUp: 1, resolved: profile ? 1 : 0 };
}

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
  let profileLookups = 0;
  let profilesResolved = 0;
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
    const externalIdentifier = `instagram:${participantId}`;
    const { data: knownIdentity } = await database.from("identities").select("username,metadata").eq("owner_id", connection.owner_id).eq("source", "instagram").eq("external_identifier", externalIdentifier).maybeSingle();
    let profile: { name?: string; username?: string } | null = null;
    const shouldLookUpProfile = profileLookups < MAX_PROFILE_LOOKUPS_PER_PASS && shouldEnrichInstagramProfile(knownIdentity);
    if (shouldLookUpProfile) {
      profileLookups += 1;
      try {
        const profileResponse = await fetch(instagramUserProfileUrl(participantId), { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(4_000) });
        if (profileResponse.ok) {
          const candidate = await profileResponse.json() as { name?: string; username?: string };
          if (candidate.name?.trim() || candidate.username?.trim()) {
            profile = candidate;
            profilesResolved += 1;
          }
        }
      } catch {
        // A profile is enrichment only. The message import remains successful
        // and a retry is deferred rather than slowing down every cron pass.
      }
    }
    const username = profile?.username?.trim() || knownIdentity?.username?.trim() || null;
    const displayName = profile?.name?.trim() || (username ? `@${username}` : `Instagram contact ${participantId.slice(-6)}`);
    const lookupMetadata = shouldLookUpProfile ? instagramProfileLookupMetadata(Date.now(), Boolean(profile)) : {};
    const person = await resolveOrCreateChannelPerson({ database, ownerId: connection.owner_id, source: "instagram", externalIdentifier, displayName, username, connectionId: connection.id, confidence: profile ? 0.8 : 0.65, contactAt: sentAt, identityMetadata: { instagram_scoped_id: participantId, discovered_by: "reconciliation", ...lookupMetadata, ...(profile?.name?.trim() ? { profile_name: profile.name.trim() } : {}) } });
    const conversationKey = `instagram:${connection.id}:${participantId}`;
    const { data: existing } = await database.from("conversations").select("id").eq("owner_id", connection.owner_id).eq("source", "instagram").eq("external_conversation_id", conversationKey).maybeSingle();
    const values: Record<string, unknown> = { owner_id: connection.owner_id, person_id: person.personId, connection_id: connection.id, source: "instagram", external_conversation_id: conversationKey, title: `Instagram · ${connection.account_identifier ?? connection.account_name ?? "account"}`, conversation_type: "direct_message", last_message_at: sentAt, ...(direction === "in" ? { last_other_message_at: sentAt } : { last_user_message_at: sentAt }), updated_at: new Date().toISOString() };
    const conversation = existing?.id ? await database.from("conversations").update(values).eq("id", existing.id).select("id").single() : await database.from("conversations").insert(values).select("id").single();
    if (conversation.error || !conversation.data) throw conversation.error ?? new Error("instagram_conversation_save_failed");
    const { data: saved, error: saveError } = await database.from("messages").upsert({ owner_id: connection.owner_id, conversation_id: conversation.data.id, external_message_id: externalId, direction, sender_identity_id: direction === "in" ? person.identityId : null, source: "instagram", body_text: body, sent_at: sentAt, attachment_count: 0, metadata: { provider: instagramConnector.id, connection_id: connection.id, reconciliation: true }, processed_at: null }, { onConflict: "owner_id,source,external_message_id", ignoreDuplicates: true }).select("id").maybeSingle();
    if (saveError) throw saveError;
    if (saved) imported += 1;
  }
  // Webhooks and the short reconciliation window only see recent activity.
  // Use the remaining bounded profile budget to gradually repair older
  // placeholder identities as well, so every UI surface resolves the same
  // canonical Person Graph record over time.
  if (profileLookups < MAX_PROFILE_LOOKUPS_PER_PASS) {
    const historical = await enrichOneHistoricalProfile({
      database,
      ownerId: connection.owner_id,
      connectionId: connection.id,
      accessToken,
    });
    profileLookups += historical.lookedUp;
    profilesResolved += historical.resolved;
  }
  await database.from("connections").update({ health_status: "healthy", last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", connection.id);
  return { imported, scanned: items.length, profileLookups, profilesResolved };
}
