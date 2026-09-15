export type MatchPerson = { id: string; display_name: string; entity_type?: string; identities: { source: string; external_identifier: string; verified_match: boolean }[] };
export function contactMatch(a: MatchPerson, b: MatchPerson) {
  const name = (v: string) => v.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const sameName = name(a.display_name) === name(b.display_name) && name(a.display_name).split(" ").length >= 2;
  const key = (i: MatchPerson["identities"][number]) => `${i.source}:${i.external_identifier.trim().toLowerCase()}`;
  const shared = a.identities.find(i => b.identities.some(j => key(i) === key(j)));
  if (!shared && !sameName) return null;
  const verified = shared?.verified_match && b.identities.some(j => key(j) === key(shared) && j.verified_match);
  const personalEmail = shared?.source === "email" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(shared.external_identifier) && !/^(info|support|sales|hello|office|admin|billing|contact|team|no-?reply)@/i.test(shared.external_identifier);
  const safe = Boolean(sameName && verified && personalEmail && a.entity_type === "person" && b.entity_type === "person");
  return { sourceId: b.id, targetId: a.id, sourceName: b.display_name, targetName: a.display_name, safe, reason: safe ? "Samma fullständiga namn och samma verifierade personliga e-postadress." : shared ? "Gemensam identitet behöver kontrolleras." : "Samma namn. Identiteterna behöver bekräftas av dig." };
}
