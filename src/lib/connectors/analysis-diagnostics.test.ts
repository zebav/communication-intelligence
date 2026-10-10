import { describe, expect, it } from "vitest";
import { AIServiceNotConfiguredError } from "@/lib/ai/service";
import { analysisFailureCode } from "./analysis-diagnostics";

describe("analysis failure diagnostics", () => {
  it("uses bounded categories rather than provider or message contents", () => {
    expect(analysisFailureCode(new AIServiceNotConfiguredError("secret"))).toBe("ai_not_configured");
    expect(analysisFailureCode(new Error("OpenAI request failed (429)."))).toBe("ai_rate_limited");
    expect(analysisFailureCode(new Error("message_analysis_persist_failed"))).toBe("analysis_persist");
    expect(analysisFailureCode(new Error("private Slack message contents"))).toBe("analysis_failed");
  });
});
