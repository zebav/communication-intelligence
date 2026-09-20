import { describe, expect, it } from "vitest";
import { browserActionRisk, browserAgentResultSchema, exactBrowserTarget } from "./browserbase-agent-policy";

describe("managed Browserbase Agent boundary", () => {
  it("accepts a public exact HTTPS target", () => {
    expect(exactBrowserTarget("https://portal.example.com/form?a=1")).toEqual({
      url: "https://portal.example.com/form?a=1",
      host: "portal.example.com",
    });
  });

  it.each([
    "http://example.com",
    "https://user:secret@example.com",
    "https://example.com:8443",
    "https://localhost/test",
  ])("rejects unsafe target %s", (value) => {
    expect(() => exactBrowserTarget(value)).toThrow();
  });

  it.each([
    "Pay the outstanding invoice by card",
    "Sign the contract online",
    "Reset my password and disable MFA",
    "Radera konto",
    "Betala fakturan",
  ])("blocks critical action text: %s", (value) => {
    expect(browserActionRisk(value)).toBe("critical");
  });

  it("allows ordinary approved portal work", () => {
    expect(browserActionRisk("Fill in the membership form and submit it")).toBe("standard");
  });

  it("requires structured confirmation and missing-field metadata", () => {
    expect(browserAgentResultSchema.parse({
      completed: false,
      submitted: false,
      summary: "Login requires a verification code.",
      finalUrl: "https://portal.example.com/login",
      confirmationText: "",
      requiresHuman: true,
      blockedReason: "Verification required",
      missingInformation: [{
        key: "verification_code",
        label: "Verification code",
        kind: "one_time_code",
        description: "Code sent to the owner.",
        sensitivity: "restricted",
      }],
    }).missingInformation[0].kind).toBe("one_time_code");
  });
});
