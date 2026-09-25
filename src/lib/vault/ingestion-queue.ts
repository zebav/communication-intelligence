import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

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
    updated_at:new Date().toISOString(),
  },{onConflict:"owner_id,provider,connection_id,provider_message_id",ignoreDuplicates:true});
  if(error) throw new Error("vault_ingestion_queue_failed");
}
