"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ContactAvatar } from "@/components/contact-avatar";
import { RelationshipBackfillControl } from "@/components/relationship-backfill-control";

const relationshipCategories = ["romantic", "friends", "family", "colleagues", "customers", "suppliers", "business_partners", "professional_network", "advisors_professional_services", "other"] as const;
type RelationshipCategory = typeof relationshipCategories[number];
const labels: Record<RelationshipCategory, string> = { romantic: "Romantiskt", friends: "Vänner", family: "Familj", colleagues: "Kollegor", customers: "Kunder", suppliers: "Leverantörer", business_partners: "Affärspartners", professional_network: "Professionellt nätverk", advisors_professional_services: "Rådgivare & tjänster", other: "Övrigt" };
const trendLabel: Record<string, string> = { rising: "↑ Stärkts", stable: "→ Stabil", cooling: "↓ Svalnat", dormant: "○ Vilande", reconnecting: "↗ Återupptas", new: "✦ Ny", uncertain: "? Begränsat underlag" };
type Payload = { category: RelationshipCategory; job: Parameters<typeof RelationshipBackfillControl>[0]["job"]; rows: Array<{ id: string; person_id: string; strength_score: number; quality_score: number; priority_score: number; ranking_score: number; trend: string; confidence: number; explanation: string; person: { id: string; display_name: string; organization: string | null; last_contact_at: string | null } }> };

export function RelationshipWorkspace() {
  const [category, setCategory] = useState<RelationshipCategory>("romantic");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const load = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(`/api/relationships?category=${category}`, { cache: "no-store", signal });
    const body = await response.json() as Payload & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Relationsunderlaget kunde inte hämtas.");
    return body;
  }, [category]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).then((payload) => {
      if (!controller.signal.aborted) { setData(payload); setError(""); }
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Relationsunderlaget kunde inte hämtas.");
    });
    return () => controller.abort();
  }, [load, attempt]);
  const retry = () => setAttempt((value) => value + 1);
  return <section className="page relationships-page"><span className="eyebrow">RELATIONSINSIKTER</span><h1>Dina relationer, rangordnade och förstådda</h1><p className="subtitle">Beslutsstöd från kommunikation, historik och bekräftad kontext – aldrig ett omdöme om en persons värde.</p><nav className="relationship-chips" aria-label="Relationskategorier">{relationshipCategories.map((item) => <button className={item === category ? "active" : ""} key={item} onClick={() => setCategory(item)}>{labels[item]}</button>)}</nav>{data && <RelationshipBackfillControl job={data.job} />}{error && <div className="empty-card negative" role="alert"><strong>Relationsanalysen kunde inte läsas.</strong><p>{error}</p><button className="btn" onClick={retry}>Försök igen</button></div>}{!data && !error && <div className="empty-card" role="status">Hämtar relationsanalys…</div>}{data && <><div className="relationship-ranking-note">Topp 10 visas när det finns tillräckligt underlag. Okänd information sänker säkerheten – den förbättrar aldrig en rankning.</div><section className="relationship-list">{data.rows.length === 0 ? <div className="empty-card"><strong>Inga kvalificerade relationer i {labels[category]} ännu.</strong><p>Solvani lägger till personer när det finns meningsfull kommunikation eller när du bekräftar relationen i Kontakter.</p></div> : data.rows.map((row, index) => <Link href={`/contacts/${row.person.id}`} className="relationship-card" key={row.id}><div className="relationship-rank">#{index + 1}</div><ContactAvatar personId={row.person.id} name={row.person.display_name} size={48} /><div className="relationship-card-body"><div className="relationship-card-head"><div><strong>{row.person.display_name}</strong><small>{labels[category]} · {trendLabel[row.trend] ?? "Begränsat underlag"}</small></div><span className="score">{Math.round(Number(row.ranking_score))}</span></div><p>{row.explanation}</p><div className="relationship-metrics"><span>Styrka <b>{Math.round(Number(row.strength_score))}</b></span><span>Kvalitet <b>{Math.round(Number(row.quality_score))}</b></span><span>Prioritet <b>{Math.round(Number(row.priority_score))}</b></span><span>Säkerhet <b>{Math.round(Number(row.confidence) * 100)}%</b></span></div></div></Link>)}</section></>}</section>;
}
