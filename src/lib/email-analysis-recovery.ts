import { isRelevantEmail } from "@/lib/connectors/email-classification";

type PendingEmail = {
  classification: string | null;
  importance_score: number | null;
  metadata: unknown;
};

function metadataObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Import completion and AI preparation are deliberately separate states.
 * Provider sync routes can safely persist a message before background
 * analysis runs, so recovery must key off the durable analysis payload rather
 * than `processed_at`. This also repairs already-imported relevant mail after
 * a previous worker interruption without touching newsletters or receipts.
 */
export function emailAnalysisRecoveryCandidates<T extends PendingEmail>(messages: T[], limit = 3): T[] {
  return messages
    .filter((message) => {
      const metadata = metadataObject(message.metadata);
      return !metadata.ai_analysis
        && (isRelevantEmail(message.classification ?? "") || Number(message.importance_score ?? 0) >= 8);
    })
    .slice(0, limit);
}
