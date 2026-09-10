const blockedHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
export function safeExternalActionUrl(value: string) {
  if (!value.trim()) return null;
  try { const url = new URL(value); if (url.protocol !== "https:" || blockedHosts.has(url.hostname.toLowerCase()) || url.username || url.password) return null; return url.toString(); }
  catch { return null; }
}
