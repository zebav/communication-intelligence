import { describe, expect, it, vi } from "vitest";
import { OpenAIResponsesService } from "@/lib/ai/service";

describe("OpenAIResponsesService", () => {
  it("requests non-retained structured analysis with minimized input", async () => {
    const output = { category: "Action Required", confidence: 0.9, summary: "Reply requested.", intent: "Request", priorityScore: 8, priorityReason: "A response is requested today.", recommendedAction: "RESPOND_TODAY", requiresReply: true, draftResponse: "Yes, I will review it today.", draftTone: "direct and warm", commitment: { detected: false, description: "", dueAt: "", owner: "unknown", confidence: 0 }, memoryCandidates: [] };
    let requestBody = "";
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => { requestBody = String(init?.body); return new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }] }), { status: 200 }); });
    const service = new OpenAIResponsesService("test-key", "test-model", request as typeof fetch);
    await expect(service.analyzeEmail({ ownerId: "owner", senderName: "A", subject: "Please reply", preview: "Can you review this?", currentClassification: "Business", styleExamples: ["Sounds good — I will check today."] })).resolves.toEqual(output);
    const body = JSON.parse(requestBody);
    expect(body.store).toBe(false); expect(body.model).toBe("test-model"); expect(body.text.format.type).toBe("json_schema");
    expect(body.input).not.toContain('"ownerId"'); expect(body.safety_identifier).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rewrites only the current draft using bounded conversation context", async () => {
    const output = { draftResponse: "Thank you. I will review this today.", draftTone: "professional and concise" };
    let requestBody = "";
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => { requestBody = String(init?.body); return new Response(JSON.stringify({ output_text: JSON.stringify(output) }), { status: 200 }); });
    const service = new OpenAIResponsesService("test-key", "test-model", request as typeof fetch);
    await expect(service.reviseEmailDraft({ ownerId: "owner", senderName: "A", subject: "Review", currentDraft: "Thanks, will check.", transformation: "more_professional", conversationMessages: [{ direction: "in", body: "Could you review this?" }] })).resolves.toEqual(output);
    const body = JSON.parse(requestBody);
    expect(body.store).toBe(false); expect(body.input).toContain("more_professional"); expect(body.input).toContain("Could you review this?");
  });

  it("does not enable web search without explicit research approval", async () => {
    const output = { overview: "A decision is requested.", stakes: "Timing and cost.", facts: ["A reply is requested Friday."], inferences: [], unknowns: ["The final price is unknown."], options: [{ label: "Ask for details", benefits: "Reduces uncertainty.", risks: "May delay the decision." }], recommendedApproach: "Clarify the price first.", responseStrategy: "Be concise and specific.", suggestedReply: "Please confirm the final price.", researchNeeded: true, researchQuestions: ["What is the market price?"], sources: [] };
    let requestBody = "";
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => { requestBody = String(init?.body); return new Response(JSON.stringify({ output_text: JSON.stringify(output) }), { status: 200 }); });
    const service = new OpenAIResponsesService("test-key", "fast-model", request as typeof fetch, "deep-model");
    await expect(service.deeplyAnalyzeEmail({ ownerId: "owner", senderName: "A", subject: "Decision", preview: "Please decide by Friday.", currentClassification: "Action Required", researchApproved: false })).resolves.toEqual(output);
    const body = JSON.parse(requestBody);
    expect(body.model).toBe("deep-model"); expect(body.store).toBe(false); expect(body.tools).toBeUndefined(); expect(body.instructions).toContain("did not approve external research");
  });

  it("enables bounded web research after explicit approval", async () => {
    const output = { overview: "A decision is requested.", stakes: "Cost.", facts: ["A proposal was sent."], inferences: [], unknowns: [], options: [], recommendedApproach: "Review the source.", responseStrategy: "Answer after verification.", suggestedReply: "Thank you. I reviewed the source.", researchNeeded: false, researchQuestions: [], sources: [{ title: "Malformed model source", url: "not-a-complete-url", supports: "Should be ignored." }] };
    let requestBody = "";
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => { requestBody = String(init?.body); return new Response(JSON.stringify({ output_text: JSON.stringify(output), output: [{ type: "web_search_call", action: { sources: [{ title: "Primary source", url: "https://example.com/source?utm_source=search" }, { title: "Another page on the same website", url: "https://www.example.com/another-article" }] } }] }), { status: 200 }); });
    const service = new OpenAIResponsesService("test-key", "fast-model", request as typeof fetch, "deep-model");
    await expect(service.deeplyAnalyzeEmail({ ownerId: "owner", senderName: "A", subject: "Proposal", preview: "Please review.", currentClassification: "Business", researchApproved: true })).resolves.toMatchObject({ sources: [{ title: "Primary source", url: "https://example.com/source?utm_source=search" }] });
    const body = JSON.parse(requestBody);
    expect(body.tools).toEqual([{ type: "web_search" }]); expect(body.tool_choice).toBe("required"); expect(body.max_tool_calls).toBe(4); expect(body.include).toContain("web_search_call.action.sources"); expect(body.text.format.schema.properties.sources.minItems).toBe(1);
  });
});
