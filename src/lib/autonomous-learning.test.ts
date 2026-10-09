import { describe, expect, it } from "vitest";
import { decideAutonomousLearning } from "./autonomous-learning";

describe("autonomous learning policy", () => {
  it("only applies repeated low-risk reply-style learning", () => {
    expect(decideAutonomousLearning({ signalType: "draft_edited", confidence: 0.8, repetitions: 3 }).shouldAutoApply).toBe(true);
  });

  it("keeps uncertain, one-off and sensitive observations for review", () => {
    expect(decideAutonomousLearning({ signalType: "draft_edited", confidence: 0.8, repetitions: 1 }).shouldAutoApply).toBe(false);
    expect(decideAutonomousLearning({ signalType: "category_corrected", confidence: 0.95, repetitions: 8 }).shouldAutoApply).toBe(false);
    expect(decideAutonomousLearning({ signalType: "draft_accepted", confidence: 0.95, repetitions: 8, sensitivity: "sensitive" }).shouldAutoApply).toBe(false);
  });
});
