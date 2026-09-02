import { describe, expect, it } from "vitest";
import { classifyEmail, emailPriority, recommendedEmailAction } from "./email-classification";

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
