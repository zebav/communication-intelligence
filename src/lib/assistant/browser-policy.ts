/** Preparatory policy only. A durable atomic usage ledger is required before activation. */
export function browserSessionPolicy(input: { approvedHost: string; targetUrl: string; reservedSeconds: number; activeSessions: number }) {
  const url = new URL(input.targetUrl);
  const host = input.approvedHost.toLowerCase();
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) || /^\d+(?:\.\d+)+$/.test(host) || /(?:^|\.)(localhost|local|internal|test|invalid)$/.test(host)) throw new Error("En godkänd offentlig domän krävs.");
  if (url.protocol !== "https:" || url.hostname !== host || url.username || url.password || (url.port && url.port !== "443")) throw new Error("Adressen matchar inte den godkända webbplatsen.");
  if (!Number.isSafeInteger(input.reservedSeconds) || input.reservedSeconds < 0 || input.reservedSeconds + 300 > 90 * 3600) throw new Error("Månadens säkerhetsgräns är nådd eller kunde inte verifieras.");
  if (input.activeSessions !== 0) throw new Error("En webbuppgift pågår redan.");
  return { timeout: 300, keepAlive: false, proxies: false, region: "eu-central-1", browserSettings: { recordSession: false, logSession: false, solveCaptchas: false, advancedStealth: false, ignoreCertificateErrors: false, allowedDomains: [host] } };
}
