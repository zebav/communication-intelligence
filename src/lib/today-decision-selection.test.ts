import { describe, expect, it } from "vitest";
import type { CommunicationCase, SyncedEmailConversation } from "./domain";
import { selectTodayChannel, selectTodayEmail } from "./today-decision-selection";

const email = (overrides: Partial<SyncedEmailConversation> = {}): SyncedEmailConversation => ({
  id: "conversation", messageId: "message", personName: "Sender", title: "Subject", preview: "Preview",
  receivedAt: "2026-10-10T10:00:00Z", classification: "Business", priorityScore: 6,
  recommendedAction: "RESPOND_LATER", unread: true, threadMessages: [], ...overrides,
});

const channel = (overrides: Partial<CommunicationCase> = {}): CommunicationCase => ({
  id: "conversation", personName: "Person", title: "Direct message", source: "instagram", message: "Hej!",
  createdAt: "2026-10-10T10:00:00Z", priorityScore: 6,
  threadMessages: [{ id: "message", direction: "in", body: "Hej!", sentAt: "2026-10-10T10:00:00Z" }], ...overrides,
});

describe("Today decision selection", () => {
  it("keeps automated forum and spam-like mail out of Today even when older data called it Business", () => {
    expect(selectTodayEmail(email({ title: "New forum reply: pinco casino", preview: "A new community post is waiting", priorityScore: 9 }))).toBe("hidden");
  });

  it("shows a critical service update as a note, not a reply task without reply evidence", () => {
    expect(selectTodayEmail(email({ title: "TestFlight: Ready for distribution", classification: "Business", priorityScore: 9 }))).toBe("note");
  });

  it("keeps a high-priority sender's concrete reply request actionable", () => {
    expect(selectTodayEmail(email({ title: "Kan du återkomma före fredag?", preview: "Please reply with your decision", classification: "Action Required", priorityScore: 8 }))).toBe("action");
  });

  it("honours an explicit low-priority sender rule unless a stored decision already exists", () => {
    expect(selectTodayEmail(email({ title: "Kan du återkomma?", classification: "Action Required", priorityScore: 9, handlingRule: "low_priority", analysis: { confidence: .9, summary: "", intent: "", priorityReason: "", requiresReply: true, draftResponse: "", draftTone: "" } }))).toBe("hidden");
    expect(selectTodayEmail(email({ handlingRule: "low_priority" }), { status: "ready" })).toBe("action");
  });

  it("surfaces a direct conversation awaiting analysis as preparation instead of an unhelpful other bucket", () => {
    expect(selectTodayChannel(channel())).toBe("preparing");
    expect(selectTodayChannel(channel({ analysis: { requiresReply: true } }))).toBe("action");
  });
});
