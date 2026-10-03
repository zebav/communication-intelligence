import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { relationshipCategories, type RelationshipCategory } from "@/lib/relationship-intelligence";
import { ContactAvatar } from "@/components/contact-avatar";
import { RelationshipBackfillControl } from "@/components/relationship-backfill-control";

export const dynamic = "force-dynamic";

const labels: Record<RelationshipCategory, string> = { romantic: "Romantic", friends: "Friends", family: "Family", colleagues: "Colleagues", customers: "Customers", suppliers: "Suppliers", business_partners: "Business Partners", professional_network: "Professional Network", advisors_professional_services: "Advisors & Services", other: "Other" };
const trendLabel = { rising: "↑ Rising", stable: "→ Stable", cooling: "↓ Cooling", dormant: "○ Dormant", reconnecting: "↗ Reconnecting", new: "✦ New", uncertain: "? Limited evidence" } as const;

export default async function RelationshipsPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const params = await searchParams;
  const category = relationshipCategories.includes(params.category as RelationshipCategory) ? params.category as RelationshipCategory : "romantic";
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) redirect("/login");
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") redirect("/auth/mfa");
  const [{ data: allSnapshots }, { data: backfill }] = await Promise.all([
    database.from("relationship_snapshots").select("id,person_id,category,strength_score,quality_score,priority_score,ranking_score,trend,confidence,evidence_count,evidence_coverage,explanation,missing_information,last_analyzed_at,snapshot_date").eq("owner_id", user.id).eq("category", category).order("snapshot_date", { ascending: false }).order("ranking_score", { ascending: false }).limit(500),
    database.from("relationship_backfill_jobs").select("status").eq("owner_id", user.id).in("status", ["pending", "running"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const latest = new Map<string, typeof allSnapshots extends (infer T)[] | null ? T : never>();
  for (const snapshot of allSnapshots ?? []) if (!latest.has(snapshot.person_id)) latest.set(snapshot.person_id, snapshot);
  const rows = [...latest.values()].filter((item) => Number(item.evidence_count) >= 3 || Number(item.confidence) >= .8).sort((a, b) => Number(b.ranking_score) - Number(a.ranking_score)).slice(0, 10);
  const ids = rows.map((row) => row.person_id);
  const { data: people } = ids.length ? await database.from("people").select("id,display_name,organization,last_contact_at").eq("owner_id", user.id).in("id", ids) : { data: [] };
  const personById = new Map((people ?? []).map((person) => [person.id, person]));
  return <main className="page relationships-page">
    <span className="eyebrow">Relationship Intelligence</span>
    <h1>Your relationships, ranked and understood</h1>
    <p className="subtitle">Scores are decision support based on communication, history and your confirmed context. They are not judgments of a person’s worth.</p>
    <nav className="relationship-chips" aria-label="Relationship categories">{relationshipCategories.map((item) => <Link className={item === category ? "active" : ""} href={`/relationships?category=${item}`} key={item}>{labels[item]}</Link>)}</nav>
    <RelationshipBackfillControl status={backfill?.status} />
    <div className="relationship-ranking-note">Top 10 are shown when there is enough evidence. Unknown information reduces confidence; it never improves a rank.</div>
    <section className="relationship-list">{rows.length === 0 ? <div className="empty-card"><strong>No qualified relationships in {labels[category]} yet.</strong><p>Solvani will add people once there is meaningful communication evidence or you confirm the relationship in Contacts.</p></div> : rows.map((snapshot, index) => {
      const person = personById.get(snapshot.person_id);
      if (!person) return null;
      return <Link href={`/contacts/${person.id}`} className="relationship-card" key={snapshot.id}>
        <div className="relationship-rank">#{index + 1}</div><ContactAvatar personId={person.id} name={person.display_name ?? "Contact"} size={48} />
        <div className="relationship-card-body"><div className="relationship-card-head"><div><strong>{person.display_name}</strong><small>{labels[category]} · {trendLabel[snapshot.trend as keyof typeof trendLabel] ?? "Uncertain"}</small></div><span className="score">{Math.round(Number(snapshot.ranking_score))}</span></div><p>{snapshot.explanation}</p><div className="relationship-metrics"><span>Strength <b>{Math.round(Number(snapshot.strength_score))}</b></span><span>Quality <b>{Math.round(Number(snapshot.quality_score))}</b></span><span>Priority <b>{Math.round(Number(snapshot.priority_score))}</b></span><span>Confidence <b>{Math.round(Number(snapshot.confidence) * 100)}%</b></span></div><small className="muted">Last meaningful interaction: {person.last_contact_at ? new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium" }).format(new Date(person.last_contact_at)) : "not yet known"}</small></div>
      </Link>;
    })}</section>
  </main>;
}
