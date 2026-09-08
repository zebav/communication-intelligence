import { describe, expect, it } from "vitest";
import { followUpSection, normalizeCommitmentDueAt } from "./commitments";

describe("commitments", () => {
  it("accepts valid dates and rejects ambiguous text", () => {
    expect(normalizeCommitmentDueAt("2026-09-12T10:00:00Z")).toBe("2026-09-12T10:00:00.000Z");
    expect(normalizeCommitmentDueAt("next week")).toBeNull();
  });

  it("places overdue commitments ahead of owner sections", () => {
    expect(followUpSection({ owner: "user", dueAt: "2026-09-01T00:00:00Z", status: "open" }, new Date("2026-09-08T00:00:00Z"))).toBe("Overdue");
    expect(followUpSection({ owner: "sender", status: "open" })).toBe("They owe me");
    expect(followUpSection({ owner: "unknown", status: "suggested" })).toBe("Review");
  });
});
