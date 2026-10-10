import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BackToWorkspaceButton } from "@/components/back-to-workspace-button";
import { ContactMergePicker } from "@/components/contact-merge-picker";
import { ContactPhotoEditor } from "@/components/contact-photo-editor";
import { RelationshipFeedback } from "@/components/relationship-feedback";
import { relationshipCategories, type RelationshipCategory } from "@/lib/relationship-intelligence";
import { relationshipLabels, type RelationshipType } from "@/lib/relationship-types";
import { presentPersonName } from "@/lib/person-presentation";

type RelationshipSnapshot = { id: string; category: string; strength_score: number | null; quality_score: number | null; priority_score: number | null; ranking_score: number | null; trend: string | null; confidence: number | null; explanation: string | null; missing_information: unknown; snapshot_date: string };

const categoryLabels: Record<string, string> = { romantic: "Romantisk", friends: "Vänner", family: "Familj", colleagues: "Kollegor", customers: "Kunder", suppliers: "Leverantörer", business_partners: "Affärspartners", professional_network: "Professionellt nätverk", advisors: "Rådgivare", other: "Övrigt" };
const mergedFieldLabels: Record<string, string> = { display_name: "Namn", organization: "Organisation", notes: "Anteckningar", relationship_summary: "Relationssammanfattning", professional_specialty: "Yrkesområde", jurisdiction: "Land eller område", relationship_type: "Relation" };

function formatDate(value: string | null, withTime = false) {
  if (!value) return "–";
  return new Intl.DateTimeFormat("sv-SE", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(new Date(value));
}

function relationshipLabel(value: string | null) {
  if (!value || value === "unknown") return "Relation inte angiven";
  return relationshipLabels[value as RelationshipType] ?? value.replaceAll("_", " ");
}

export const dynamic = "force-dynamic";

export default async function ContactProfilePage({ params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) redirect("/login");
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") redirect("/auth/mfa");
  const { data: mergedInto } = await database.from("contact_merges").select("target_id").eq("owner_id", user.id).eq("source_id", personId).is("undone_at", null).maybeSingle();
  if (mergedInto) redirect(`/contacts/${mergedInto.target_id}`);

  const [{ data: person }, { data: mergedProfiles }, { data: identities }, { data: conversations }, { data: memories }, { data: commitments }, { data: relationshipRows }] = await Promise.all([
    database.from("people").select("id,display_name,organization,relationship_type,entity_type,professional_specialty,jurisdiction,notes,relationship_summary,manual_priority,overall_priority,first_contact_at,last_contact_at").eq("id", personId).eq("owner_id", user.id).maybeSingle(),
    database.from("contact_merges").select("id,source_profile,created_at").eq("owner_id", user.id).eq("target_id", personId).is("undone_at", null),
    database.from("identities").select("id,source,external_identifier,username,profile_url,verified_match,confidence").eq("owner_id", user.id).eq("person_id", personId).order("created_at", { ascending: true }),
    database.from("conversations").select("id,title,source,last_message_at,summary,priority_score,recommended_action").eq("owner_id", user.id).eq("person_id", personId).order("last_message_at", { ascending: false, nullsFirst: false }).limit(30),
    database.from("memories").select("id,category,content,confidence,user_verified,created_at").eq("owner_id", user.id).eq("person_id", personId).order("created_at", { ascending: false }).limit(20),
    database.from("commitments").select("id,description,commitment_owner,due_at,status,confidence").eq("owner_id", user.id).eq("person_id", personId).in("status", ["suggested", "open"]).order("due_at", { ascending: true, nullsFirst: false }).limit(20),
    database.from("relationship_snapshots").select("id,category,strength_score,quality_score,priority_score,ranking_score,trend,confidence,explanation,missing_information,snapshot_date").eq("owner_id", user.id).eq("person_id", personId).order("snapshot_date", { ascending: false }).limit(30),
  ]);
  if (!person) notFound();
  const latestRelationships = new Map<string, RelationshipSnapshot>();
  for (const snapshot of relationshipRows ?? []) if (!latestRelationships.has(snapshot.category)) latestRelationships.set(snapshot.category, snapshot);
  const priority = Number(person.manual_priority ?? person.overall_priority ?? 0);
  const contactName = presentPersonName({
    displayName: person.display_name,
    identities: identities ?? [],
    fallback: "Kontakt",
  });
  const profileUrl = identities?.find((identity) => identity.profile_url)?.profile_url;

  return <main className="page contact-profile-page">
    <div className="contact-profile-toolbar"><BackToWorkspaceButton /><Link className="btn primary" href={`/contacts/${encodeURIComponent(personId)}/edit`}>Redigera kontakt</Link></div>
    <section className="contact-profile-hero"><ContactPhotoEditor personId={personId} name={contactName} /><div className="contact-profile-title"><span className="eyebrow">Kontakt</span><h1>{contactName}</h1><p>{[person.organization, relationshipLabel(person.relationship_type)].filter(Boolean).join(" · ")}</p></div><div className="contact-profile-actions"><a className="btn" href="#historik">Historik</a>{profileUrl && <a className="btn" href={profileUrl} target="_blank" rel="noreferrer">Öppna profil</a>}</div></section>
    <section className="contact-profile-overview" aria-label="Översikt"><div><strong>{priority || "–"}</strong><span>Prioritet</span></div><div><strong>{identities?.length ?? 0}</strong><span>Anslutna identiteter</span></div><div><strong>{conversations?.length ?? 0}</strong><span>Konversationer</span></div><div><strong>{commitments?.length ?? 0}</strong><span>Öppna åtaganden</span></div></section>
    <section className="contact-profile-section contact-summary-card"><div><span className="intel-label">Relationssammanfattning</span><h2>Det viktigaste just nu</h2></div><p>{person.relationship_summary || "Ingen bekräftad relationssammanfattning ännu. Solvani använder bara relevant kommunikation och din bekräftade kontext."}</p>{person.notes && <details><summary>Privata anteckningar</summary><p>{person.notes}</p></details>}</section>

    {latestRelationships.size > 0 && <section className="contact-profile-section"><div className="contact-section-heading"><div><span className="intel-label">Relationsintelligens</span><h2>Aktuell relationsbild</h2></div><Link href="/relationships" className="btn">Visa relationer</Link></div><div className="relationship-profile-grid">{[...latestRelationships.values()].map((snapshot) => {
      const category = relationshipCategories.includes(snapshot.category as RelationshipCategory) ? snapshot.category as RelationshipCategory : "other";
      return <article className="card relationship-profile-card" key={snapshot.id}><div className="card-top"><strong>{categoryLabels[category] ?? category.replaceAll("_", " ")}</strong><span className="score">{Math.round(Number(snapshot.ranking_score))}</span></div><div className="relationship-metrics"><span>Styrka <b>{Math.round(Number(snapshot.strength_score))}</b></span><span>Kvalitet <b>{Math.round(Number(snapshot.quality_score))}</b></span><span>Prioritet <b>{Math.round(Number(snapshot.priority_score))}</b></span><span>Säkerhet <b>{Math.round(Number(snapshot.confidence) * 100)}%</b></span></div><p>{snapshot.explanation || "Bedömningen bygger på tillgängligt underlag."}</p>{Array.isArray(snapshot.missing_information) && snapshot.missing_information.length > 0 && <small className="muted">Saknar underlag: {snapshot.missing_information.join(" · ")}</small>}<RelationshipFeedback personId={personId} category={category} /></article>;
    })}</div></section>}

    <section className="contact-profile-section contact-details-grid"><article className="card"><span className="intel-label">Kontaktuppgifter</span><div className="person-stack"><div className="person-fact"><strong>Organisation</strong><span>{person.organization || "Inte angivet"}</span></div><div className="person-fact"><strong>Yrkesområde</strong><span>{person.professional_specialty || "Inte angivet"}</span></div><div className="person-fact"><strong>Land eller område</strong><span>{person.jurisdiction || "Inte angivet"}</span></div><div className="person-fact"><strong>Första kontakt</strong><span>{formatDate(person.first_contact_at)}</span></div><div className="person-fact"><strong>Senaste kontakt</strong><span>{formatDate(person.last_contact_at, true)}</span></div></div></article><article className="card"><span className="intel-label">Anslutna identiteter</span>{(identities ?? []).length === 0 ? <p className="muted">Inga identiteter har kopplats till kontakten ännu.</p> : <div className="person-stack">{identities?.map((identity) => <div className="person-fact" key={identity.id}><strong>{identity.source}</strong><span>{identity.username || identity.external_identifier}</span><small>{identity.verified_match ? "Verifierad koppling" : "Föreslagen koppling"}</small></div>)}</div>}</article></section>
    <section id="historik" className="contact-profile-section"><div className="contact-section-heading"><div><span className="intel-label">Kommunikation</span><h2>Senaste historik</h2></div></div>{(conversations ?? []).length === 0 ? <div className="empty-card">Inga konversationer är kopplade till kontakten ännu.</div> : <div className="contact-history-list">{conversations?.map((conversation) => <article className="contact-history-item" key={conversation.id}><div><strong>{conversation.title || "Konversation"}</strong><small>{conversation.source} · {formatDate(conversation.last_message_at, true)}</small></div><p>{conversation.summary || "Ingen sammanfattning ännu."}</p>{conversation.priority_score != null && <span className="pill">Prioritet {Number(conversation.priority_score)}</span>}</article>)}</div>}</section>
    <section className="contact-profile-section contact-details-grid"><article className="card"><span className="intel-label">Sparad kontext</span>{(memories ?? []).length === 0 ? <p className="muted">Ingen bekräftad information sparad ännu.</p> : <div className="person-stack">{memories?.map((memory) => <div className="person-fact" key={memory.id}><strong>{memory.category}</strong><span>{memory.content}</span><small className={memory.user_verified ? "positive" : "muted"}>{memory.user_verified ? "Bekräftad av dig" : "Väntar på bekräftelse"}</small></div>)}</div>}</article><article className="card"><span className="intel-label">Öppna åtaganden</span>{(commitments ?? []).length === 0 ? <p className="muted">Inga öppna åtaganden med kontakten.</p> : <div className="person-stack">{commitments?.map((item) => <div className="person-fact" key={item.id}><strong>{item.commitment_owner === "user" ? "Du ansvarar" : item.commitment_owner === "sender" ? "Kontakten ansvarar" : "Åtagande"}</strong><span>{item.description}</span><small>{item.due_at ? `Senast ${formatDate(item.due_at)}` : "Ingen tidsgräns"}</small></div>)}</div>}</article></section>
    <section className="contact-profile-section"><details className="contact-merge-details"><summary>Sammanförda kontaktuppgifter</summary><p>Visar bevarad källhistorik. Sammanför bara kontaktkort när det verkligen är samma person.</p>{(mergedProfiles ?? []).map((merge) => <div className="merge-history" key={merge.id}>{Object.entries(merge.source_profile as Record<string, unknown>).filter(([key, value]) => Boolean(value) && key in mergedFieldLabels).map(([key, value]) => <div key={key}><strong>{mergedFieldLabels[key]}</strong><span>{key === "relationship_type" ? relationshipLabel(String(value)) : String(value)}</span></div>)}</div>)}<ContactMergePicker personId={personId} name={contactName} /></details></section>
  </main>;
}
