const normalize = (value: string) => value.toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/^@/, "").replace(/[^a-z0-9]+/g, " ").trim();

export function contactMatchScore(instagramName: string, instagramUsername: string, candidateName: string, candidateIdentifiers: string[] = []) {
  const name = normalize(instagramName); const username = normalize(instagramUsername).replaceAll(" ", ""); const candidate = normalize(candidateName);
  if (!candidate || (!name && !username)) return 0;
  if (name && name === candidate) return 1;
  const candidateCompact = candidate.replaceAll(" ", "");
  if (username && (username === candidateCompact || candidateIdentifiers.some((value) => normalize(value).replaceAll(" ", "") === username))) return 0.98;
  const left = new Set(name.split(" ").filter((part) => part.length > 1)); const right = new Set(candidate.split(" ").filter((part) => part.length > 1));
  const shared = [...left].filter((part) => right.has(part)).length;
  if (shared >= 2) return 0.9;
  if (shared === 1 && Math.max(left.size, right.size) <= 2) return 0.65;
  return 0;
}

export function confidentContactMatches<T extends { id: string; name: string; identifiers?: string[] }>(instagramName: string, instagramUsername: string, candidates: T[]) {
  return candidates.map((candidate) => ({ candidate, confidence: contactMatchScore(instagramName, instagramUsername, candidate.name, candidate.identifiers) })).filter((item) => item.confidence >= 0.8).sort((a, b) => b.confidence - a.confidence).slice(0, 3);
}
