import { describe, expect, it } from "vitest";
import { decisionContextPrompt } from "@/lib/assistant/decision-context";

describe("decision context prompt", () => {
  it("keeps provenance and excludes incidental clock data when useful evidence exists", () => {
    const prompt = decisionContextPrompt({
      version: "v1",
      preparedAt: "2026-10-10T12:00:00.000Z",
      items: [
        { kind: "time", source: "system", summary: "Aktuell tidpunkt", verified: true },
        { kind: "relationship", source: "relationship_intelligence", summary: "friend: relationens prioritet 80/100", verified: false, confidence: 0.8 },
      ],
    });
    expect(prompt).toContain("[relationship_intelligence, bedömning]");
    expect(prompt).not.toContain("Aktuell tidpunkt");
  });
});
