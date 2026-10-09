import { describe, expect, it } from "vitest";
import { emailAnalysisRecoveryCandidates } from "./email-analysis-recovery";

describe("emailAnalysisRecoveryCandidates", () => {
  it("recovers a relevant imported email when its AI analysis is missing", () => {
    const candidates = emailAnalysisRecoveryCandidates([
      { classification: "Business", importance_score: 6, metadata: {}, processed_at: "2026-10-09T09:00:00.000Z" },
      { classification: "Marketing", importance_score: 2, metadata: {}, processed_at: null },
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.classification).toBe("Business");
  });

  it("does not reprocess an email that already has a persisted analysis", () => {
    const candidates = emailAnalysisRecoveryCandidates([
      { classification: "Action Required", importance_score: 9, metadata: { ai_analysis: { summary: "ready" } } },
    ]);

    expect(candidates).toEqual([]);
  });

  it("keeps low-priority marketing mail out of the recovery queue", () => {
    const candidates = emailAnalysisRecoveryCandidates([
      { classification: "Marketing", importance_score: 2, metadata: {} },
    ]);

    expect(candidates).toEqual([]);
  });
});
