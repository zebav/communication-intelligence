import { z } from "zod";

export const browserAgentResultSchema = z.object({
  completed: z.boolean(),
  submitted: z.boolean(),
  summary: z.string().max(2000),
  finalUrl: z.string().max(4096),
  confirmationText: z.string().max(2000),
  requiresHuman: z.boolean(),
  blockedReason: z.string().max(1000),
  missingInformation: z.array(z.object({
    key: z.string().min(1).max(80),
    label: z.string().min(1).max(120),
    kind: z.enum(["text","email","phone","date","username","password","account_number","one_time_code","other"]),
    description: z.string().max(240),
    sensitivity: z.enum(["personal","sensitive","restricted"]),
  })).max(12),
});
export type BrowserAgentResult = z.infer<typeof browserAgentResultSchema>;

export function exactBrowserTarget(raw: string) {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(url.hostname)
  ) throw new Error("Webbadressen är inte tillåten.");
  return { url: url.href, host: url.hostname.toLowerCase() };
}

export function browserActionRisk(text: string) {
  const normalized = text.toLocaleLowerCase();
  const critical = [
    /\b(pay|payment|purchase|buy|checkout|charge|transfer money|wire|bank transfer)\b/i,
    /\b(bet|gambl|casino)\b/i,
    /\b(sign (the )?(contract|agreement|document)|legal signature|e-sign)\b/i,
    /\b(delete (my )?(account|profile)|close account)\b/i,
    /\b(change (my )?password|reset password|disable mfa|remove mfa|security settings)\b/i,
    /\b(godkänn avtal|signera|betala|betalning|köp|banköverföring|överför pengar|radera konto|byt lösenord)\b/i,
  ];
  return critical.some((pattern) => pattern.test(normalized)) ? "critical" as const : "standard" as const;
}
