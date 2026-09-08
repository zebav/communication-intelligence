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
