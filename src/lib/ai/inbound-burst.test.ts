import { describe, expect, it } from "vitest";
import { inboundBurst } from "./inbound-burst";

describe("inboundBurst", () => {
  it("groups consecutive incoming messages from the same local day", () => {
    const result = inboundBurst([
      { id: "a", direction: "out", body: "Hej", sentAt: "2026-10-01T08:00:00.000Z" },
      { id: "b", direction: "in", body: "Kan du?", sentAt: "2026-10-01T09:00:00.000Z" },
      { id: "c", direction: "in", body: "Det gäller idag.", sentAt: "2026-10-01T09:03:00.000Z" },
    ], "c");
    expect(result.messageIds).toEqual(["b", "c"]);
    expect(result.text).toContain("Kan du?");
    expect(result.text).toContain("Det gäller idag.");
  });

  it("does not cross the owner's reply or date boundary", () => {
    const result = inboundBurst([
      { id: "a", direction: "in", body: "Första", sentAt: "2026-10-01T08:00:00.000Z" },
      { id: "b", direction: "out", body: "Svar", sentAt: "2026-10-01T08:05:00.000Z" },
      { id: "c", direction: "in", body: "Andra", sentAt: "2026-10-01T08:06:00.000Z" },
    ], "c");
    expect(result.messageIds).toEqual(["c"]);
  });
});
