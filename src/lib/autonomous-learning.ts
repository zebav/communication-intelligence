import "server-only";

export type LearningMode = "automatic" | "review_required" | "blocked";
export type FactState = "confirmed" | "inferred" | "uncertain";
export type LearningSensitivity = "personal" | "sensitive" | "restricted";

export type LearningPolicyInput = {
  signalType: string;
  confidence: number;
  repetitions: number;
  sensitivity?: LearningSensitivity;
  source?: string;
};

export type LearningPolicyDecision = {
  learningMode: LearningMode;
  factState: FactState;
  autonomyLevel: 0 | 1;
  shouldAutoApply: boolean;
  reason: string;
};

const ROUTINE_SIGNAL_TYPES = new Set(["draft_accepted", "draft_edited"]);
const MIN_CONFIDENCE = 0.75;
const MIN_REPETITIONS = 3;

/**
 * The only autonomous learning allowed in V1 is a repeated low-risk writing
 * preference. It never creates credentials, relationship facts, health/legal
 * conclusions, scheduling actions or outbound communication.
 */
export function decideAutonomousLearning(input: LearningPolicyInput): LearningPolicyDecision {
  const sensitivity = input.sensitivity ?? "personal";
  if (sensitivity !== "personal") {
    return { learningMode: "review_required", factState: "inferred", autonomyLevel: 0, shouldAutoApply: false, reason: "Sensitive or restricted information always requires review." };
  }
  if (!ROUTINE_SIGNAL_TYPES.has(input.signalType)) {
    return { learningMode: "review_required", factState: "inferred", autonomyLevel: 0, shouldAutoApply: false, reason: "This kind of learning can affect decisions and requires review." };
  }
  if (input.confidence < MIN_CONFIDENCE || input.repetitions < MIN_REPETITIONS) {
    return { learningMode: "review_required", factState: "inferred", autonomyLevel: 0, shouldAutoApply: false, reason: "More consistent owner behaviour is needed before this preference is applied automatically." };
  }
  return { learningMode: "automatic", factState: "inferred", autonomyLevel: 1, shouldAutoApply: true, reason: "Repeated, low-risk reply-style preference supported by owner-approved behaviour." };
}

export function repetitionsFromEvidence(evidence: unknown) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return 0;
  const repetitions = (evidence as Record<string, unknown>).repetitions;
  return typeof repetitions === "number" && Number.isFinite(repetitions) ? repetitions : 0;
}
