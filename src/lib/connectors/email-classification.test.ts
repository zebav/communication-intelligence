import { describe, expect, it } from "vitest";
import { classifyEmail, emailPriority, isRelevantEmail, recommendedEmailAction } from "./email-classification";

describe("email classification", () => {
  it("protects high importance messages", () => {
    expect(classifyEmail({ subject: "Account update", importance: "high" })).toBe("Critical");
    expect(emailPriority("Critical")).toBe(9);
  });

  it("recognizes common safe categories", () => {
    expect(classifyEmail({ subject: "Your invoice is ready" })).toBe("Receipt / Invoice");
    expect(classifyEmail({ preview: "Manage preferences or unsubscribe" })).toBe("Newsletter");
    expect(recommendedEmailAction("Newsletter")).toBe("ARCHIVE");
  });
});

describe("email relevance", () => {
  it("keeps human/actionable mail and filters low-value automated mail", () => {
    expect(isRelevantEmail("Action Required")).toBe(true);
    expect(isRelevantEmail("Personal")).toBe(true);
    expect(isRelevantEmail("Newsletter")).toBe(false);
    expect(isRelevantEmail("Notification")).toBe(false);
  });
});
