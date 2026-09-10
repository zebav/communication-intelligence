import { describe, expect, it } from "vitest";
import { enforceProfessionalRouting } from "@/lib/action-routing";
import type { EmailAnalysis } from "@/lib/ai/service";

const base: EmailAnalysis = { category: "Business", confidence: 0.8, summary: "A document needs review.", intent: "Request", priorityScore: 7, priorityReason: "Action is requested.", recommendedAction: "RESPOND_TODAY", requiresReply: true, draftResponse: "Thank you.", draftTone: "professional", commitment: { detected: false, description: "", dueAt: "", owner: "unknown", confidence: 0 }, memoryCandidates: [], relationshipSuggestion: { type: "advisor", confidence: 0.5, reason: "" }, forwardingSuggestion: { recommended: false, recipientRole: "none", reason: "", introduction: "" } };

describe("professional routing guardrails", () => {
  it("routes Spanish legal matters to a lawyer", () => {
    const result = enforceProfessionalRouting(base, "The notario needs the escritura for the property in Spain.");
    expect(result.forwardingSuggestion).toMatchObject({ recommended: true, recipientRole: "lawyer" });
    expect(result.forwardingSuggestion.reason).toContain("Spanish");
  });
  it("does not overwrite a deliberate AI routing decision", () => {
    const chosen = { ...base, forwardingSuggestion: { recommended: true, recipientRole: "advisor" as const, reason: "Specialist review", introduction: "Please review." } };
    expect(enforceProfessionalRouting(chosen, "Spain")).toBe(chosen);
  });
});
