import { z } from "zod";

const blockedHostnames = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "169.254.169.254",
]);

const blockedSuffixes = [".local", ".internal", ".localhost"];

export const browserRiskSchema = z.enum(["low", "medium", "high", "critical"]);
export type BrowserRisk = z.infer<typeof browserRiskSchema>;

export type BrowserDomainPolicy = {
  exactHosts: string[];
  browserbaseDomains: string[];
};

function normalizeHostname(value: string) {
  return value.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

function isBlockedHostname(hostname: string) {
  if (!hostname || blockedHostnames.has(hostname)) return true;
  if (blockedSuffixes.some((suffix) => hostname.endsWith(suffix))) return true;
  if (/^(10|127)\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  const private172 = hostname.match(/^172\.(\d{1,3})\./);
  if (private172) {
    const octet = Number(private172[1]);
    if (octet >= 16 && octet <= 31) return true;
  }
  return false;
}

export function exactHttpsHost(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const hostname = normalizeHostname(url.hostname);
    if (isBlockedHostname(hostname)) return null;
    return hostname;
  } catch {
    return null;
  }
}

export function buildBrowserDomainPolicy(urls: string[]): BrowserDomainPolicy | null {
  const exactHosts = [...new Set(urls.map(exactHttpsHost).filter((host): host is string => Boolean(host)))];
  if (!exactHosts.length || exactHosts.length !== urls.length) return null;

  return {
    exactHosts,
    // Browserbase matches each entry plus all of its subdomains. We deliberately
    // pass the most-specific host we have, while our own exact-host checks remain
    // authoritative for agent navigation decisions.
    browserbaseDomains: exactHosts,
  };
}

export function isExactHostAllowed(targetUrl: string, exactHosts: string[]) {
  const host = exactHttpsHost(targetUrl);
  return Boolean(host && exactHosts.map(normalizeHostname).includes(host));
}

export function requiresExplicitApproval(risk: BrowserRisk) {
  return risk === "high" || risk === "critical";
}

export function mayExecuteBrowserAction(input: {
  risk: BrowserRisk;
  approved: boolean;
  targetUrl: string;
  exactHosts: string[];
}) {
  if (!isExactHostAllowed(input.targetUrl, input.exactHosts)) return false;
  if (input.risk === "critical") return false;
  if (requiresExplicitApproval(input.risk) && !input.approved) return false;
  return true;
}
