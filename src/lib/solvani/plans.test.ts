import { describe, expect, it } from "vitest";
import { isPlanCode, normalizePlanLimits } from "@/lib/solvani/plans";

describe("Solvani plans", () => {
  it("accepts only defined plans", () => {
    expect(isPlanCode("pro")).toBe(true);
    expect(isPlanCode("enterprise")).toBe(false);
  });

  it("fails safely to the plan defaults for malformed limits", () => {
    expect(normalizePlanLimits({ monthlyAiCredits: -1, connectedAccounts: 2.5 }, "starter")).toEqual({ monthlyAiCredits: 250, monthlyBrowserMinutes: 30, connectedAccounts: 3 });
  });
});
