import { describe, expect, it } from "vitest";
import { evidenceFromRow } from "./repository";
import { propose } from "./model";

describe("historical assistant evidence", () => {
  it("keeps a legacy email actionable when a nested analysis field is missing", () => {
    const evidence = evidenceFromRow({
      id: "35e15ce1-5ceb-4176-93cc-4ef2ebf1c820",
      conversation_id: "7f5e805e-a312-4311-b576-39ab99a84ed7",
      source: "email", direction: "in", body_text: "Please suggest a time for our call.",
      sent_at: "2026-09-17T17:26:01Z", classification: "Action Required", importance_score: 8.6,
      metadata: { ai_analysis: {
        summary: "A callback needs to be scheduled.", intent: "Schedule a call", requiresReply: true,
        draftResponse: "Thank you. I will suggest a time.", priorityReason: "A response is requested.",
        commitment: { description: "Suggest a time", dueAt: "", owner: "user", confidence: 0.98 },
      } },
      identities: { external_identifier: "support@example.com" },
      conversations: { id: "7f5e805e-a312-4311-b576-39ab99a84ed7", title: "Callback", person_id: null, connection_id: "268719f0-7b93-457d-8bc4-9c6a9de0252b", external_conversation_id: "thread", last_user_message_at: null, last_other_message_at: "2026-09-17T17:26:01Z", people: null, connections: { provider: "gmail", account_identifier: "me@example.com" } },
    });

    expect(evidence.analysis.requiresReply).toBe(true);
    expect(evidence.analysis.commitment?.detected).toBe(true);
    expect(propose(evidence)).toEqual(["reply"]);
  });
  it("keeps unread state as ranking evidence, never as an automatic task", () => {
    const evidence = evidenceFromRow({
      id: "35e15ce1-5ceb-4176-93cc-4ef2ebf1c820", conversation_id: "7f5e805e-a312-4311-b576-39ab99a84ed7",
      source: "email", direction: "in", body_text: "Information", sent_at: "2026-09-17T17:26:01Z", classification: "Information Only", importance_score: 10,
      metadata: { is_read: false }, identities: { external_identifier: "news@example.com" },
      conversations: { id: "7f5e805e-a312-4311-b576-39ab99a84ed7", title: "Nyhetsbrev", person_id: null, connection_id: "268719f0-7b93-457d-8bc4-9c6a9de0252b", external_conversation_id: "thread", last_user_message_at: null, last_other_message_at: "2026-09-17T17:26:01Z", people: null, connections: { provider: "gmail", account_identifier: "me@example.com" } },
    });
    expect(evidence.unread).toBe(true);
    expect(propose(evidence)).toEqual([]);
  });
});
