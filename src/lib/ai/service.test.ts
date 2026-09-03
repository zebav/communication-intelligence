import { describe, expect, it, vi } from "vitest";
import { OpenAIResponsesService } from "@/lib/ai/service";

describe("OpenAIResponsesService", () => {
  it("requests non-retained structured analysis with minimized input", async () => {
    const output = { category: "Action Required", confidence: 0.9, summary: "Reply requested.", intent: "Request", priorityScore: 8, priorityReason: "A response is requested today.", recommendedAction: "RESPOND_TODAY", requiresReply: true, draftResponse: "Yes, I will review it today.", draftTone: "direct and warm", commitment: { detected: false, description: "", dueAt: "", owner: "unknown", confidence: 0 } };
    let requestBody = "";
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => { requestBody = String(init?.body); return new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }] }), { status: 200 }); });
    const service = new OpenAIResponsesService("test-key", "test-model", request as typeof fetch);
    await expect(service.analyzeEmail({ ownerId: "owner", senderName: "A", subject: "Please reply", preview: "Can you review this?", currentClassification: "Business", styleExamples: ["Sounds good — I will check today."] })).resolves.toEqual(output);
    const body = JSON.parse(requestBody);
    expect(body.store).toBe(false); expect(body.model).toBe("test-model"); expect(body.text.format.type).toBe("json_schema");
    expect(body.input).not.toContain('"ownerId"'); expect(body.safety_identifier).toMatch(/^[a-f0-9]{64}$/);
  });
});
