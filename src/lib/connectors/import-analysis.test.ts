import { describe, expect, it } from "vitest";
import { parseImportedConversationAnalysis } from "./import-analysis";

describe("parseImportedConversationAnalysis", () => {
  it("safely bounds verbose screenshot analysis instead of rejecting it", () => {
    const result = parseImportedConversationAnalysis(JSON.stringify({
      source: "imessage",
      accountLabel: "Personal",
      participantName: "A".repeat(180),
      ownerName: "Me",
      title: "T".repeat(250),
      transcript: "Other: Hello",
      summary: "S".repeat(800),
      intent: "I".repeat(500),
      priorityScore: 12,
      recommendedAction: "R".repeat(160),
      draftResponse: "D".repeat(5000),
      draftTone: "Professional",
    }));

    expect(result.participantName).toHaveLength(120);
    expect(result.title).toHaveLength(200);
    expect(result.summary).toHaveLength(600);
    expect(result.priorityScore).toBe(10);
    expect(result.draftResponse).toHaveLength(4000);
  });

  it("supplies safe labels when the model returns blank optional-looking fields", () => {
    const result = parseImportedConversationAnalysis(JSON.stringify({
      source: "manual", accountLabel: "", participantName: "", ownerName: "", title: "", transcript: "",
      summary: "", intent: "", priorityScore: 0, recommendedAction: "", draftResponse: "", draftTone: "",
    }));

    expect(result.participantName).toBe("Unknown");
    expect(result.ownerName).toBe("Me");
    expect(result.priorityScore).toBe(1);
  });
});
