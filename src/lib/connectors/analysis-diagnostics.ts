import { AIServiceNotConfiguredError } from "@/lib/ai/service";

/**
 * Convert analysis failures into bounded operational categories. Provider
 * responses and message text must never be emitted in cron logs.
 */
export function analysisFailureCode(error: unknown) {
  if (error instanceof AIServiceNotConfiguredError) return "ai_not_configured";
  const message = error instanceof Error ? error.message : "";
  if (/OpenAI request failed \(401\)/.test(message)) return "ai_auth";
  if (/OpenAI request failed \(429\)/.test(message)) return "ai_rate_limited";
  if (/OpenAI request failed \([45]\d\d\)/.test(message) || /abort/i.test(message)) return "ai_provider";
  if (message === "message_analysis_persist_failed") return "analysis_persist";
  if (/decision|task/i.test(message)) return "decision_persist";
  return "analysis_failed";
}
