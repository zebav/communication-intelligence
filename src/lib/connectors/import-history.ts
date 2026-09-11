import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImportedConversationAnalysis } from "@/lib/connectors/import-analysis";

export async function importedConversationHistory(database: SupabaseClient, ownerId: string, analysis: ImportedConversationAnalysis) {
  const identityKey = `import:${analysis.source}:${analysis.participantName.trim().toLocaleLowerCase()}`;
  const { data: identity } = await database.from("identities").select("person_id").eq("owner_id", ownerId).eq("source", analysis.source).eq("external_identifier", identityKey).maybeSingle();
  if (!identity?.person_id) return "";
  const { data: conversations } = await database.from("conversations").select("id").eq("owner_id", ownerId).eq("person_id", identity.person_id).eq("source", analysis.source).order("last_message_at", { ascending: false, nullsFirst: false }).limit(100);
  const conversationIds = (conversations ?? []).map((item) => item.id);
  if (!conversationIds.length) return "";
  const { data: messages } = await database.from("messages").select("direction,body_text,sent_at").eq("owner_id", ownerId).eq("source", analysis.source).in("conversation_id", conversationIds).order("sent_at", { ascending: false }).limit(250);
  return [...(messages ?? [])].reverse().map((item) => `${item.sent_at ?? "Unknown time"} · ${item.direction === "out" ? "Me" : analysis.participantName}: ${item.body_text ?? ""}`).join("\n").slice(-32_000);
}
