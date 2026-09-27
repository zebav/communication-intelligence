import type { Plan } from "./model";

/**
 * A link may be absent from an older AI analysis even though it exists in the
 * original message. This recovers only a directly stated, ordinary HTTPS URL.
 * It deliberately does not follow redirects or trust a generated URL.
 */
export function verifiedHttpsUrl(...values: string[]) {
  for (const value of values) {
    const matches = value.matchAll(/https:\/\/[^\s<>"']+/gi);
    for (const match of matches) {
      const raw = match[0].replace(/[),.;!?]+$/g, "");
      try {
        const url = new URL(raw);
        if (
          url.protocol !== "https:" || url.username || url.password ||
          (url.port && url.port !== "443") ||
          !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(url.hostname)
        ) continue;
        return url.href;
      } catch { /* Try the next literal link. */ }
    }
  }
  return "";
}

export function browserTargetUrl(plan: Pick<Plan, "evidence">) {
  const action = plan.evidence.analysis.actionSuggestion;
  return verifiedHttpsUrl(action?.targetUrl?.trim() ?? "", plan.evidence.body, plan.evidence.title);
}
