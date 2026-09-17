/** Pure checks; call inside a durable transaction, never against client supplied usage. */
export const WEB_BUDGET = { browserSeconds: 90 * 3600, aiMicroUsd: 10_000_000, sessionSeconds: 300 } as const;

export function reserveWebBudget(input: {
  now: number; periodStart: number; periodEnd: number;
  browserSeconds: number; aiMicroUsd: number; requestedAiMicroUsd: number;
  activeSessions: number;
}) {
  for (const value of Object.values(input)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Budgetunderlaget kunde inte verifieras.");
  }
  if (input.periodStart >= input.periodEnd || input.now < input.periodStart || input.now >= input.periodEnd) throw new Error("Faktureringsperioden måste stämmas av.");
  // Do not let a session straddle a billing reset; stale counters must never reset themselves.
  if (input.now + WEB_BUDGET.sessionSeconds * 1000 >= input.periodEnd) throw new Error("Vänta tills nästa faktureringsperiod har verifierats.");
  if (input.activeSessions !== 0) throw new Error("En webbuppgift pågår redan.");
  const browserSeconds = input.browserSeconds + WEB_BUDGET.sessionSeconds;
  const aiMicroUsd = input.aiMicroUsd + input.requestedAiMicroUsd;
  if (!Number.isSafeInteger(aiMicroUsd) || browserSeconds > WEB_BUDGET.browserSeconds || aiMicroUsd > WEB_BUDGET.aiMicroUsd) throw new Error("Månadens kostnadsgräns är nådd.");
  return { browserSeconds, aiMicroUsd, activeSessions: 1 };
}
