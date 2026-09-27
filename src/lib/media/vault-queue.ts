import type { SupabaseClient } from "@supabase/supabase-js";

export type MediaQueueInput = {
  ownerId: string; connectionId: string | null; provider: string; source: string;
  providerMessageId: string; messageId: string; conversationId: string; personId: string | null;
  messageText: string; attachmentCount: number; mediaTypes: string[];
};

/** Durable, idempotent queue. Provider URLs and credentials are never stored. */
export async function enqueueMediaAnalysis(database: SupabaseClient, input: MediaQueueInput) {
  if (input.attachmentCount < 1) return { queued: false as const, reason: "no_attachments" };
  const { data: existing, error: lookupError } = await database.from("vault_ingestion_jobs")
    .select("id,state").eq("owner_id", input.ownerId).eq("provider", input.provider)
    .eq("provider_message_id", input.providerMessageId).maybeSingle();
  if (lookupError) throw new Error("Media queue could not be checked.");
  if (existing) return { queued: false as const, reason: "already_queued", id: String(existing.id), state: String(existing.state) };
  const { data, error } = await database.from("vault_ingestion_jobs").insert({
    owner_id: input.ownerId, connection_id: input.connectionId, provider: input.provider,
    source_type: input.source, provider_message_id: input.providerMessageId,
    source_message_id: input.messageId, source_conversation_id: input.conversationId,
    source_person_id: input.personId, message_text: input.messageText.slice(0, 16_000), state: "pending",
    metadata: { attachment_count: input.attachmentCount, media_types: input.mediaTypes.slice(0, 12), fetch_strategy: "provider_worker_required", decision_gate: "block_until_media_ready" },
  }).select("id,state").single();
  if (error || !data) throw new Error("Media queue could not be created.");
  return { queued: true as const, id: String(data.id), state: String(data.state) };
}
