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

  it("recognizes obvious forum and bulk-spam notices before the Business fallback", () => {
    expect(classifyEmail({ subject: "New forum reply: casino offer", preview: "A new community post is waiting" })).toBe("Spam");
    expect(classifyEmail({ subject: "Reply to this thread", preview: "A community digest is ready" })).toBe("Notification");
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
