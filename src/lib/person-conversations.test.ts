import { describe, expect, it } from "vitest";
import { deduplicatePersonConversations } from "./person-conversations";

describe("deduplicatePersonConversations", () => {
  it("keeps distinct threads from the same communication channel", () => {
    const result = deduplicatePersonConversations([
      { id: "one", source: "whatsapp", external_conversation_id: "thread-a", last_message_at: "2026-10-01T10:00:00Z" },
      { id: "two", source: "whatsapp", external_conversation_id: "thread-b", last_message_at: "2026-10-01T11:00:00Z" },
    ]);

    expect(result.map((row) => row.id)).toEqual(["one", "two"]);
  });

  it("keeps only the freshest replayed copy of the same provider thread", () => {
    const result = deduplicatePersonConversations([
      { id: "old", source: "instagram", external_conversation_id: "thread-a", last_message_at: "2026-10-01T10:00:00Z" },
      { id: "new", source: "instagram", external_conversation_id: "thread-a", last_message_at: "2026-10-02T10:00:00Z" },
    ]);

    expect(result.map((row) => row.id)).toEqual(["new"]);
  });
});
