import { describe, expect, it } from "vitest";
import { classifyMediaFailure, mediaFailureUpdate, nextMediaRetryAt } from "./ingestion-lifecycle";

describe("media ingestion lifecycle", () => {
  it("retries a storage failure with a bounded delay", () => {
    const now = new Date("2026-10-03T10:00:00.000Z");
    expect(classifyMediaFailure(new Error("vault_upload_failed"))).toEqual({ code: "vault_upload_failed", stage: "storage", retryable: true });
    expect(mediaFailureUpdate(new Error("vault_upload_failed"), 1, now)).toMatchObject({ state: "failed", failed_stage: "storage", next_retry_at: nextMediaRetryAt(1, now), dead_lettered_at: null });
  });

  it("moves permanent and exhausted failures to the terminal queue", () => {
    const now = new Date("2026-10-03T10:00:00.000Z");
    expect(mediaFailureUpdate(new Error("reconnect_required"), 1, now)).toMatchObject({ state: "dead_letter", failed_stage: "connection", next_retry_at: null });
    expect(mediaFailureUpdate(new Error("vault_upload_failed"), 3, now)).toMatchObject({ state: "dead_letter", failed_stage: "storage", next_retry_at: null });
  });
});
