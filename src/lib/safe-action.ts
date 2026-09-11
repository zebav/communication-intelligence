const blockedHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
export function safeExternalActionUrl(value: string) {
  if (!value.trim()) return null;
  try { const url = new URL(value); if (url.protocol !== "https:" || blockedHosts.has(url.hostname.toLowerCase()) || url.username || url.password) return null; return url.toString(); }
  catch { return null; }
}

export function firstSafeExternalActionUrl(value: string) {
  const candidates = value.match(/https:\/\/[^\s<>"']+/gi) ?? [];
  for (const candidate of candidates) {
    const safe = safeExternalActionUrl(candidate.replace(/[),.;!?]+$/, ""));
    if (safe) return safe;
  }
  return null;
}


export function bestSafeExternalActionUrl(value: string) {
  const matches = [...value.matchAll(/https:\/\/[^\s<>"']+/gi)];
  const ranked = matches.flatMap((match) => {
    const url = safeExternalActionUrl(match[0].replace(/[),.;!?]+$/, ""));
    if (!url) return [];
    const index = match.index ?? 0;
    const preceding = value.slice(Math.max(0, index - 120), index);
    const boundary = Math.max(preceding.lastIndexOf(">"), preceding.lastIndexOf("\n"), preceding.lastIndexOf("."));
    const context = preceding.slice(boundary + 1).toLowerCase();
    const positive = (context.match(/start|continue|complete|verify|verification|form|submit|sign in|log in|access|öppna|fortsätt|slutför|verifiera|formulär|logga in/g) ?? []).length;
    const negative = (context.match(/learn more|privacy|support|unsubscribe|tracking|pixel|\.gif|läs mer|integritet|support|avregistrera/g) ?? []).length;
    return [{ url, score: positive * 3 - negative * 4 }];
  });
  return ranked.sort((a, b) => b.score - a.score)[0]?.url ?? null;
}