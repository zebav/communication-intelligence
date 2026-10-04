export const maxAutomaticMediaAttempts = 3;

export type MediaFailureStage = "connection" | "download" | "storage" | "analysis" | "persistence" | "claim" | "unknown";

export type MediaFailure = {
  code: string;
  stage: MediaFailureStage;
  retryable: boolean;
};

function messageOf(error: unknown) {
  return error instanceof Error && error.message ? error.message.slice(0, 120) : "media_worker_failed";
}

export function classifyMediaFailure(error: unknown): MediaFailure {
  const code = messageOf(error);
  if (code === "vault_upload_failed") return { code, stage: "storage", retryable: true };
  if (code === "vault_asset_save_failed") return { code, stage: "persistence", retryable: true };
  if (code === "reconnect_required" || code.includes("connection_") || code.includes("credential_")) return { code, stage: "connection", retryable: false };
  if (code.startsWith("audio_") || code.startsWith("document_analysis_") || code.startsWith("openai_") || code.includes("analysis")) return { code, stage: "analysis", retryable: /_(429|5\d\d)(?:_|$)/.test(code) };
  if (code.startsWith("gmail_") || code.startsWith("outlook_") || code.startsWith("media_fetch_") || code.startsWith("whatsapp_media_")) return { code, stage: "download", retryable: /_(401|403|408|429|5\d\d)(?:_|$)/.test(code) };
  if (code === "processing_timeout") return { code, stage: "claim", retryable: true };
  return { code, stage: "unknown", retryable: false };
}

export function nextMediaRetryAt(attempts: number, now = new Date()) {
  const minutes = Math.min(60, 2 ** Math.max(0, attempts - 1) * 5);
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

export function mediaFailureUpdate(error: unknown, attempts: number, now = new Date()) {
  const failure = classifyMediaFailure(error);
  const exhausted = !failure.retryable || attempts >= maxAutomaticMediaAttempts;
  const retrievalFailed = failure.stage === "connection" || failure.stage === "download" || failure.stage === "claim";
  const analysisFailed = failure.stage === "analysis";
  return {
    state: exhausted ? "dead_letter" : "failed",
    last_error_code: failure.code,
    failed_stage: failure.stage,
    error_details: { code: failure.code, stage: failure.stage, retryable: failure.retryable, recorded_at: now.toISOString() },
    next_retry_at: exhausted ? null : nextMediaRetryAt(attempts, now),
    dead_lettered_at: exhausted ? now.toISOString() : null,
    retrieval_status: retrievalFailed ? "failed" : "available",
    analysis_status: analysisFailed ? "failed" : "blocked",
    vault_status: failure.stage === "storage" || failure.stage === "persistence" ? "failed" : "not_evaluated",
    updated_at: now.toISOString(),
  };
}
