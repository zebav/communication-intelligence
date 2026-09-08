import { describe, expect, it } from "vitest";
import { approvedLearningContext, draftLearning } from "@/lib/learning-feedback";

describe("learning feedback", () => {
  it("recognizes an unchanged accepted draft", () => { expect(draftLearning("Thank you for the update.", "Thank you for the update.", "customer").signalType).toBe("draft_accepted"); });
  it("suggests shorter replies after a substantial cut", () => { const result = draftLearning("Thank you for the detailed update. I will review everything carefully and reply tomorrow.", "Thanks. I will reply tomorrow.", "partner"); expect(result.proposedRule).toContain("shorter"); expect(result.evidence.lengthRatio).toBeLessThanOrEqual(0.8); });
  it("uses only bounded approved rules", () => { expect(approvedLearningContext(Array.from({ length: 15 }, (_, index) => ({ proposed_rule: `Rule ${index}` }))).split("\n")).toHaveLength(12); });
});
