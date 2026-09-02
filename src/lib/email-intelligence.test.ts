import { describe, expect, it } from "vitest";
import { emailDashboardSummary, prioritizeEmails } from "./email-intelligence";
import type { SyncedEmailConversation } from "./domain";

const email = (overrides: Partial<SyncedEmailConversation>): SyncedEmailConversation => ({
  id: "conversation", messageId: "message", personName: "Sender", title: "Subject", preview: "Preview",
  receivedAt: "2026-09-02T10:00:00Z", classification: "Business", priorityScore: 6,
  recommendedAction: "RESPOND_LATER", unread: true, ...overrides,
});

describe("live email intelligence", () => {
  it("places critical messages before lower-attention mail", () => {
    const ordered = prioritizeEmails([email({ id: "marketing", classification: "Marketing", priorityScore: 2.5 }), email({ id: "critical", classification: "Critical", priorityScore: 9 })]);
    expect(ordered.map((item) => item.id)).toEqual(["critical", "marketing"]);
  });

  it("derives dashboard counts from real messages", () => {
    expect(emailDashboardSummary([email({}), email({ id: "read", unread: false, classification: "Newsletter", priorityScore: 2.5, recommendedAction: "ARCHIVE" })])).toEqual({ total: 2, unread: 1, critical: 0, needsResponse: 1, lowAttention: 1 });
  });
});
