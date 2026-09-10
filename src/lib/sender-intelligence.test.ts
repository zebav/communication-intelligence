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
  it("raises unhandled mail and established two-way relationships", () => {
    const result = senderRelevance({ basePriority: 5, unread: true, historicalConversationCount: 24, hasOwnerReplies: true });
    expect(result.score).toBe(7.9);
    expect(result.reasons).toContain("Unread message is still unhandled.");
    expect(result.reasons).toContain("Frequent communication history indicates a close or important contact.");
  });
});
