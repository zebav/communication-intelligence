import type { BrowserDomainPolicy } from "./domain-policy";

export type BrowserSession = {
  id: string;
  status: string;
  expiresAt?: string;
};

type BrowserbaseSessionResponse = {
  id?: string;
  status?: string;
  expiresAt?: string;
};

function browserbaseConfig() {
  const apiKey = process.env.BROWSERBASE_API_KEY?.trim();
  const projectId = process.env.BROWSERBASE_PROJECT_ID?.trim();
  if (!apiKey || !projectId) return null;
  return { apiKey, projectId };
}

export function browserbaseConfigured() {
  return Boolean(browserbaseConfig());
}

export async function createRestrictedBrowserSession(input: {
  policy: BrowserDomainPolicy;
  timeoutSeconds?: number;
  metadata?: Record<string, unknown>;
}): Promise<BrowserSession> {
  const config = browserbaseConfig();
  if (!config) throw new Error("Browserbase is not configured.");

  const timeout = Math.min(Math.max(input.timeoutSeconds ?? 900, 60), 3600);
  const response = await fetch("https://api.browserbase.com/v1/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BB-API-Key": config.apiKey,
    },
    body: JSON.stringify({
      projectId: config.projectId,
      timeout,
      keepAlive: false,
      browserSettings: {
        allowedDomains: input.policy.browserbaseDomains,
      },
      userMetadata: input.metadata ?? {},
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Browserbase session creation failed (${response.status})${detail ? `: ${detail.slice(0, 240)}` : ""}`);
  }

  const payload = (await response.json()) as BrowserbaseSessionResponse;
  if (!payload.id) throw new Error("Browserbase did not return a session id.");

  return {
    id: payload.id,
    status: payload.status ?? "RUNNING",
    expiresAt: payload.expiresAt,
  };
}
