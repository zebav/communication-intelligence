export type SenderHandlingRule = "normal" | "always_priority" | "low_priority";

const relationshipBoost: Record<string, number> = {
  customer: 1.5, partner: 1.25, investor: 1.25, colleague: 0.75,
  family: 1, friend: 0.75, supplier: 0.25, unknown: 0,
};

export function senderRelevance(input: { basePriority: number; relationshipType?: string | null; manualPriority?: number | null; handlingRule?: string | null }) {
  const relationship = (input.relationshipType || "unknown").toLowerCase();
  let score = input.basePriority + (relationshipBoost[relationship] ?? 0);
  const reasons = [`Message category contributes ${input.basePriority}/10.`];
  if ((relationshipBoost[relationship] ?? 0) > 0) reasons.push(`Verified relationship (${relationship}) increases relevance.`);
  if (input.manualPriority != null) {
    score = score * 0.6 + input.manualPriority * 0.4;
    reasons.push(`Your sender priority is ${input.manualPriority}/10.`);
  }
  if (input.handlingRule === "always_priority") { score = Math.max(score, 8.5); reasons.push("Your rule: always prioritize this sender."); }
  if (input.handlingRule === "low_priority") { score = Math.min(score, 3); reasons.push("Your rule: keep this sender low priority."); }
  return { score: Math.round(Math.min(10, Math.max(1, score)) * 10) / 10, reasons };
}
