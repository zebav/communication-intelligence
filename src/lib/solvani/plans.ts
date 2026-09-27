export const planCodes = ["private_beta", "starter", "pro", "concierge"] as const;
export type PlanCode = typeof planCodes[number];
export type PlanStatus = "trialing" | "active" | "paused" | "past_due" | "canceled";

export type PlanLimits = {
  monthlyAiCredits: number;
  monthlyBrowserMinutes: number;
  connectedAccounts: number;
};

export const planDefinitions: Record<PlanCode, { name: string; limits: PlanLimits }> = {
  private_beta: { name: "Private beta", limits: { monthlyAiCredits: 0, monthlyBrowserMinutes: 0, connectedAccounts: 0 } },
  starter: { name: "Starter", limits: { monthlyAiCredits: 250, monthlyBrowserMinutes: 30, connectedAccounts: 3 } },
  pro: { name: "Pro", limits: { monthlyAiCredits: 1_200, monthlyBrowserMinutes: 180, connectedAccounts: 8 } },
  concierge: { name: "Concierge", limits: { monthlyAiCredits: 4_000, monthlyBrowserMinutes: 600, connectedAccounts: 20 } },
};

export function isPlanCode(value: unknown): value is PlanCode {
  return typeof value === "string" && (planCodes as readonly string[]).includes(value);
}

export function normalizePlanLimits(value: unknown, planCode: PlanCode): PlanLimits {
  const defaults = planDefinitions[planCode].limits;
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const candidate = value as Partial<PlanLimits>;
  const positiveInteger = (number: unknown, fallback: number) => typeof number === "number" && Number.isSafeInteger(number) && number >= 0 ? number : fallback;
  return {
    monthlyAiCredits: positiveInteger(candidate.monthlyAiCredits, defaults.monthlyAiCredits),
    monthlyBrowserMinutes: positiveInteger(candidate.monthlyBrowserMinutes, defaults.monthlyBrowserMinutes),
    connectedAccounts: positiveInteger(candidate.connectedAccounts, defaults.connectedAccounts),
  };
}
