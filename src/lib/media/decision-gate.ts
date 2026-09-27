/** A message with media must not be treated as fully understood before analysis. */
export type MediaDecisionState = "not_applicable" | "pending" | "processing" | "ready" | "failed" | "blocked";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function mediaDecisionState(metadata: unknown, attachmentCount = 0): MediaDecisionState {
  const state = record(metadata).media_analysis_status;
  if (state === "pending" || state === "processing" || state === "ready" || state === "failed" || state === "blocked" || state === "not_applicable") return state;
  return attachmentCount > 0 ? "pending" : "not_applicable";
}

export function blocksDecisionUntilMediaReady(metadata: unknown, attachmentCount = 0) {
  const state = mediaDecisionState(metadata, attachmentCount);
  return state === "pending" || state === "processing";
}

export function mediaDecisionLabel(state: MediaDecisionState) {
  return {
    not_applicable: "Ingen media att analysera",
    pending: "Media väntar på säker analys",
    processing: "Media analyseras",
    ready: "Media analyserad",
    failed: "Media kunde inte analyseras",
    blocked: "Media kräver manuell granskning",
  }[state];
}
