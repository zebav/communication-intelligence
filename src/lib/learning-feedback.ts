import type { SupabaseClient } from "@supabase/supabase-js";

export type DraftLearning = {
  signalType: "draft_accepted" | "draft_edited";
  observation: string;
  proposedRule: string;
  confidence: number;
  evidence: { originalWords: number; finalWords: number; lengthRatio: number };
};

const words = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;
const contextLabel = (relationship?: string | null) => relationship && relationship !== "unknown" ? `${relationship} email conversations` : "email conversations";

export function draftLearning(originalDraft: string, finalReply: string, relationship?: string | null): DraftLearning {
  const originalWords = words(originalDraft);
  const finalWords = words(finalReply);
  const lengthRatio = originalWords ? Math.round((finalWords / originalWords) * 100) / 100 : 1;
  const normalizedOriginal = originalDraft.trim().replace(/\s+/g, " ");
  const normalizedFinal = finalReply.trim().replace(/\s+/g, " ");
  if (normalizedOriginal === normalizedFinal) return { signalType: "draft_accepted", observation: `You sent an AI draft unchanged in ${contextLabel(relationship)}.`, proposedRule: `The current reply style may work well in ${contextLabel(relationship)}.`, confidence: 0.65, evidence: { originalWords, finalWords, lengthRatio } };
  if (lengthRatio <= 0.8) return { signalType: "draft_edited", observation: `You shortened an AI draft before sending it in ${contextLabel(relationship)}.`, proposedRule: `Prefer shorter replies in ${contextLabel(relationship)}.`, confidence: 0.75, evidence: { originalWords, finalWords, lengthRatio } };
  if (lengthRatio >= 1.25) return { signalType: "draft_edited", observation: `You expanded an AI draft before sending it in ${contextLabel(relationship)}.`, proposedRule: `Include more context in replies for ${contextLabel(relationship)}.`, confidence: 0.7, evidence: { originalWords, finalWords, lengthRatio } };
  return { signalType: "draft_edited", observation: `You rewrote an AI draft before sending it in ${contextLabel(relationship)}.`, proposedRule: `Use your edited reply as a style reference for ${contextLabel(relationship)}.`, confidence: 0.6, evidence: { originalWords, finalWords, lengthRatio } };
}

export const toneRule: Record<string, string> = {
  shorter: "Prefer a shorter reply", warmer: "Prefer a warmer reply", more_direct: "Prefer a more direct reply", more_professional: "Prefer a more professional reply", more_diplomatic: "Prefer a more diplomatic reply", rewrite: "The first draft often needs a fresh rewrite",
};

export function approvedLearningContext(items: { proposed_rule: string }[]) {
  return items.slice(0, 12).map((item) => item.proposed_rule.trim()).filter(Boolean).join("\n");
}

type LearningSuggestion = {
  ownerId: string;
  personId?: string | null;
  conversationId?: string | null;
  source: string;
  signalType: string;
  observation: string;
  proposedRule: string;
  evidence: Record<string, unknown>;
  confidence: number;
};

export async function saveLearningSuggestion(supabase: SupabaseClient, suggestion: LearningSuggestion) {
  let existingQuery = supabase.from("learning_signals").select("id,evidence,confidence").eq("owner_id", suggestion.ownerId).eq("source", suggestion.source).eq("signal_type", suggestion.signalType).eq("proposed_rule", suggestion.proposedRule).eq("status", "suggested");
  existingQuery = suggestion.personId ? existingQuery.eq("person_id", suggestion.personId) : existingQuery.is("person_id", null);
  const { data: existing } = await existingQuery.order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (existing) {
    const previousEvidence = existing.evidence && typeof existing.evidence === "object" && !Array.isArray(existing.evidence) ? existing.evidence as Record<string, unknown> : {};
    const repetitions = typeof previousEvidence.repetitions === "number" ? previousEvidence.repetitions + 1 : 2;
    return supabase.from("learning_signals").update({ observation: suggestion.observation, conversation_id: suggestion.conversationId, evidence: { ...previousEvidence, ...suggestion.evidence, repetitions }, confidence: Math.max(Number(existing.confidence ?? 0), suggestion.confidence), updated_at: new Date().toISOString() }).eq("id", existing.id).eq("owner_id", suggestion.ownerId);
  }
  const result = await supabase.from("learning_signals").insert({ owner_id: suggestion.ownerId, person_id: suggestion.personId, conversation_id: suggestion.conversationId, source: suggestion.source, signal_type: suggestion.signalType, observation: suggestion.observation, proposed_rule: suggestion.proposedRule, evidence: { ...suggestion.evidence, repetitions: 1 }, confidence: suggestion.confidence, status: "suggested" });
  if (result.error?.code === "23505") return { ...result, error: null };
  return result;
}
