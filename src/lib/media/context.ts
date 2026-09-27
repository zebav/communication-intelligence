import type { SupabaseClient } from "@supabase/supabase-js";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Returns only the smallest structured, already-analyzed evidence needed for
 * a communication decision. Raw bytes and private storage paths never enter an
 * AI prompt. */
export type AnalyzedMediaContext = { filename: string; mimeType: string; summary: string; extractedText: string; keyFacts: string[]; responseRelevance: "material" | "none" | "uncertain"; ownerReviewNeeded: boolean };

export async function mediaContextForMessage(database: SupabaseClient, ownerId: string, messageId: string): Promise<AnalyzedMediaContext[]> {
  const { data, error } = await database.from("vault_assets")
    .select("title,mime_type,summary,ai_decision")
    .eq("owner_id", ownerId).eq("source_message_id", messageId)
    .order("created_at", { ascending: true }).limit(12);
  if (error || !data?.length) return [];
  return data.map((asset) => {
    const decision = record(asset.ai_decision);
    const facts = Array.isArray(decision.key_facts) ? decision.key_facts.filter((fact): fact is string => typeof fact === "string").map((fact) => fact.slice(0, 500)).slice(0, 12) : [];
    const responseRelevance: AnalyzedMediaContext["responseRelevance"] = decision.response_relevance === "material" || decision.response_relevance === "none" ? decision.response_relevance : "uncertain";
    return {
      filename: String(asset.title ?? "Attachment").slice(0, 240),
      mimeType: String(asset.mime_type ?? "application/octet-stream").slice(0, 160),
      summary: String(asset.summary ?? "").slice(0, 1800),
      extractedText: typeof decision.extracted_text === "string" ? decision.extracted_text.slice(0, 12_000) : typeof decision.transcript === "string" ? decision.transcript.slice(0, 12_000) : "",
      keyFacts: facts,
      responseRelevance,
      ownerReviewNeeded: decision.needs_owner_review === true,
    };
  });
}
