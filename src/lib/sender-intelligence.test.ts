import { describe, expect, it } from "vitest";
import { senderRelevance } from "./sender-intelligence";

describe("sender relevance", () => {
  it("combines content with owner-verified relationship and priority", () => {
    const result = senderRelevance({ basePriority: 6, relationshipType: "customer", manualPriority: 9 });
    expect(result.score).toBe(8.1);
    expect(result.reasons).toHaveLength(3);
  });
  it("honors explicit handling rules within safe bounds", () => {
    expect(senderRelevance({ basePriority: 2.5, handlingRule: "always_priority" }).score).toBe(8.5);
    expect(senderRelevance({ basePriority: 9, handlingRule: "low_priority" }).score).toBe(3);
  });
});
