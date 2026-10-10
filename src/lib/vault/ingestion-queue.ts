import type { SupabaseClient } from "@supabase/supabase-js";

function safeQueueFailureCode(code: unknown) {
  // Database messages can carry private identifiers. Operational logging only
  // needs a bounded category to distinguish schema, relation and transport
  // failures while keeping the underlying provider/message private.
  switch (code) {
    case "23503": return "foreign_key";
    case "23505": return "conflict";
    case "23514": return "constraint";
    case "22P02": return "invalid_value";
    default: return "write_failed";
  }
}

export async function queueVaultIngestion(db:SupabaseClient,input:{
  ownerId:string; connectionId:string; provider:string; sourceType:"email"|"whatsapp"|"instagram"|"manual"|"other";
  providerMessageId:string; sourceMessageId:string; sourceConversationId:string; sourcePersonId?:string|null; messageText?:string;
  metadata?:Record<string,unknown>;
}) {
  const {error}=await db.from("vault_ingestion_jobs").upsert({
    owner_id:input.ownerId,
    connection_id:input.connectionId,
    provider:input.provider,
    source_type:input.sourceType,
    provider_message_id:input.providerMessageId,
    source_message_id:input.sourceMessageId,
    source_conversation_id:input.sourceConversationId,
    source_person_id:input.sourcePersonId??null,
    message_text:(input.messageText??"").slice(0,6000),
    metadata:input.metadata??{},
    state:"pending",
    retrieval_status:"queued",
    analysis_status:"queued",
    vault_status:"not_evaluated",
    updated_at:new Date().toISOString(),
  },{onConflict:"owner_id,provider,connection_id,provider_message_id",ignoreDuplicates:true});
  if(error) throw new Error(`vault_ingestion_queue_${safeQueueFailureCode(error.code)}`);
}
