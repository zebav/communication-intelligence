import { describe, expect, it } from "vitest";
import { formatResponseTime, outcomeAgeDays, positiveOutcomeRule, responseTimeMinutes } from "@/lib/outcomes";

describe("communication outcomes", () => {
  it("calculates a response time without accepting negative durations", () => {
    expect(responseTimeMinutes("2026-09-09T08:00:00Z", "2026-09-09T09:30:00Z")).toBe(90);
    expect(responseTimeMinutes("2026-09-09T10:00:00Z", "2026-09-09T09:30:00Z")).toBeNull();
  });
  it("formats useful time ranges", () => { expect(formatResponseTime(90)).toBe("2 hr"); expect(formatResponseTime(2880)).toBe("2 days"); });
  it("computes full waiting days", () => { expect(outcomeAgeDays("2026-09-01T00:00:00Z", new Date("2026-09-04T12:00:00Z"))).toBe(3); });
  it("does not claim causation in a successful-outcome rule", () => { expect(positiveOutcomeRule({ personName: "Alex", relationship: "customer", replyWordCount: 42 })).toContain("was followed by"); });
});
