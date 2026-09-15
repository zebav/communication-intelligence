import { describe, it, expect } from "vitest";
import { priorityV3 } from "./priority-v3";
describe("priority V3", () => {
  it("does not promote a frequent unread campaign containing urgent language", () => {
    expect(priorityV3({ basePriority: 9, classification: "Marketing", text: "Urgent! Can you buy now?", unread: true, historicalConversationCount: 100, hasOwnerReplies: true }).score).toBe(2);
  });
  it("distinguishes read from handled and weighs a legal deadline", () => {
    const input = { basePriority: 6, classification: "Legal", requiresReply: true, dueAt: "2026-09-15T12:00:00Z", now: Date.parse("2026-09-15T10:00:00Z") };
    expect(priorityV3({ ...input, unread: false }).score).toBeGreaterThan(8);
    expect(priorityV3({ ...input, unread: true }).score).toBeGreaterThan(priorityV3({ ...input, unread: false }).score);
  });
  it("does not interpret a missing deadline as overdue", () => {
    expect(priorityV3({ basePriority: 4, dueAt: "unknown" }).reasons.join(" ")).not.toContain("tidsfrist");
  });
});
