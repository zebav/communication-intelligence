import "server-only";

export const relationshipCategories = [
  "romantic", "friends", "family", "colleagues", "customers", "suppliers", "business_partners", "professional_network", "advisors_professional_services", "other",
] as const;
export type RelationshipCategory = (typeof relationshipCategories)[number];
export type RelationshipTrend = "rising" | "stable" | "cooling" | "dormant" | "reconnecting" | "new" | "uncertain";

export type RelationshipSignal = {
  type: "interaction" | "reciprocity" | "responsiveness" | "support" | "shared_context" | "reliability" | "commitment" | "owner_context";
  score: number;
  confidence: number;
  observedAt: string;
  direction?: "in" | "out" | "mutual" | "owner";
  sourceType: "message" | "conversation" | "calendar_event" | "contact" | "personal_context" | "commitment" | "user_feedback";
  sourceId: string;
  summary: string;
};

export type RelationshipScoreInput = {
  category: RelationshipCategory;
  categoryConfidence: number;
  manualPriority?: number | null;
  previousRankingScore?: number | null;
  signals: RelationshipSignal[];
  now?: Date;
};

export type RelationshipScore = {
  strengthScore: number;
  qualityScore: number;
  priorityScore: number;
  rankingScore: number;
  interactionFrequencyScore: number;
  recencyScore: number;
  reciprocityScore: number;
  responsivenessScore: number;
  emotionalDepthScore: number;
  reliabilityScore: number;
  sharedContextScore: number;
  trajectoryScore: number;
  confidence: number;
  evidenceCoverage: number;
  evidenceCount: number;
  trend: RelationshipTrend;
  missingInformation: string[];
  explanation: string;
};

const clamp = (value: number) => Math.round(Math.max(0, Math.min(100, value)) * 100) / 100;
const average = (values: number[], fallback = 0) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
const signalsFor = (signals: RelationshipSignal[], type: RelationshipSignal["type"]) => signals.filter((signal) => signal.type === type);

export function categoryForLegacyRelationship(type?: string | null): RelationshipCategory | null {
  switch (type) {
    case "partner": case "dating": return "romantic";
    case "close_friend": case "friend": case "neighbor": return "friends";
    case "family": return "family";
    case "colleague": case "manager": case "employee": return "colleagues";
    case "customer": case "prospect": return "customers";
    case "supplier": return "suppliers";
    case "business_partner": case "investor": return "business_partners";
    case "advisor": case "lawyer": case "accountant": case "insurance_contact": case "authority_contact": return "advisors_professional_services";
    case "fan_follower": return "professional_network";
    case "other": return "other";
    default: return null;
  }
}

const priorityBase: Record<RelationshipCategory, number> = {
  romantic: 55, friends: 42, family: 60, colleagues: 52, customers: 66, suppliers: 55, business_partners: 72, professional_network: 38, advisors_professional_services: 58, other: 30,
};

export function scoreRelationship(input: RelationshipScoreInput): RelationshipScore {
  const now = input.now ?? new Date();
  const interaction = signalsFor(input.signals, "interaction");
  const reciprocity = signalsFor(input.signals, "reciprocity");
  const responsiveness = signalsFor(input.signals, "responsiveness");
  const support = signalsFor(input.signals, "support");
  const shared = signalsFor(input.signals, "shared_context");
  const reliability = [...signalsFor(input.signals, "reliability"), ...signalsFor(input.signals, "commitment")];
  const ownerContext = signalsFor(input.signals, "owner_context");
  const lastObserved = input.signals.map((signal) => new Date(signal.observedAt).getTime()).filter(Number.isFinite).sort((a, b) => b - a)[0];
  const ageDays = lastObserved == null ? 365 : Math.max(0, (now.getTime() - lastObserved) / 86_400_000);
  const interactionFrequencyScore = clamp(Math.min(100, interaction.length * 18 + average(interaction.map((signal) => signal.score), 0) * 0.35));
  const recencyScore = clamp(100 * Math.exp(-ageDays / 45));
  const reciprocityScore = clamp(average(reciprocity.map((signal) => signal.score), 50));
  const responsivenessScore = clamp(average(responsiveness.map((signal) => signal.score), 50));
  const emotionalDepthScore = clamp(average(support.map((signal) => signal.score), 0));
  const reliabilityScore = clamp(average(reliability.map((signal) => signal.score), 50));
  const sharedContextScore = clamp(average([...shared, ...ownerContext].map((signal) => signal.score), 0));
  const positiveMomentum = average(interaction.slice(-5).map((signal) => signal.score), 0);
  const trajectoryScore = clamp(positiveMomentum || recencyScore);
  const strengthBase = 0.24 * interactionFrequencyScore + 0.16 * recencyScore + 0.2 * reciprocityScore + 0.1 * responsivenessScore + 0.12 * emotionalDepthScore + 0.1 * sharedContextScore + 0.08 * reliabilityScore;
  const qualityBase = 0.3 * reciprocityScore + 0.25 * responsivenessScore + 0.2 * reliabilityScore + 0.15 * emotionalDepthScore + 0.1 * trajectoryScore;
  const manualPriority = input.manualPriority == null ? null : clamp(Number(input.manualPriority) * 10);
  const priorityBaseScore = priorityBase[input.category];
  const priorityRaw = 0.36 * priorityBaseScore + 0.24 * (manualPriority ?? priorityBaseScore) + 0.16 * recencyScore + 0.14 * reliabilityScore + 0.1 * trajectoryScore;
  const evidenceCount = input.signals.length;
  const evidenceCoverage = Math.min(1, evidenceCount / 12);
  const confidence = evidenceCount === 0 ? 0 : Math.round(Math.min(1, input.categoryConfidence * (0.4 + evidenceCoverage * 0.6) * average(input.signals.map((signal) => signal.confidence), 0.65)) * 1000) / 1000;
  // Unknown evidence is neither positive nor negative. It reduces how much a
  // relationship can outrank one backed by real observed evidence.
  const confidenceAdjusted = (value: number) => clamp(value * (0.55 + confidence * 0.45));
  const strengthScore = confidenceAdjusted(strengthBase);
  const qualityScore = confidenceAdjusted(qualityBase);
  const priorityScore = confidenceAdjusted(priorityRaw);
  const rankingScore = clamp(0.38 * strengthScore + 0.28 * qualityScore + 0.34 * priorityScore);
  const change = input.previousRankingScore == null ? 0 : rankingScore - input.previousRankingScore;
  const trend: RelationshipTrend = evidenceCount < 3 ? "uncertain" : ageDays > 90 ? "dormant" : input.previousRankingScore == null ? "new" : change >= 5 ? "rising" : change <= -5 ? "cooling" : "stable";
  const missingInformation: string[] = [];
  if (evidenceCount < 4) missingInformation.push("Limited interaction history");
  if (!reciprocity.length) missingInformation.push("Limited evidence about mutual initiative");
  if (!shared.length && !ownerContext.length) missingInformation.push("Limited owner-confirmed shared context");
  if (!reliability.length) missingInformation.push("Limited evidence about follow-through");
  const explanation = `${trend === "rising" ? "Momentum is improving" : trend === "cooling" ? "Recent momentum is lower" : trend === "dormant" ? "The relationship is currently inactive" : "Current relationship pattern"}; based on ${evidenceCount} observed signals. Strength reflects contact and reciprocity; quality reflects response and follow-through; priority reflects your context and current relevance.`;
  return { strengthScore, qualityScore, priorityScore, rankingScore, interactionFrequencyScore, recencyScore, reciprocityScore, responsivenessScore, emotionalDepthScore, reliabilityScore, sharedContextScore, trajectoryScore, confidence, evidenceCoverage, evidenceCount, trend, missingInformation, explanation };
}
