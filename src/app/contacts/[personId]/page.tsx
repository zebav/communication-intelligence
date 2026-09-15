import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BackToWorkspaceButton } from "@/components/back-to-workspace-button";
import { ContactProfileEditor } from "@/components/contact-profile-editor";

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
  const { data: mergedProfiles } = await database.from("contact_merges").select("id,source_profile").eq("owner_id", user.id).eq("target_id", personId).is("undone_at", null);

  const [{ data: person }, { data: identities }, { data: conversations }, { data: memories }, { data: commitments }] = await Promise.all([
    database.from("people").select("id,display_name,organization,relationship_type,entity_type,professional_specialty,jurisdiction,notes,relationship_summary,manual_priority,overall_priority,first_contact_at,last_contact_at").eq("id", personId).eq("owner_id", user.id).maybeSingle(),
    database.from("identities").select("id,source,external_identifier,username,profile_url,verified_match,confidence").eq("owner_id", user.id).eq("person_id", personId).order("created_at", { ascending: true }),
    database.from("conversations").select("id,title,source,last_message_at,summary,priority_score,recommended_action").eq("owner_id", user.id).eq("person_id", personId).order("last_message_at", { ascending: false, nullsFirst: false }).limit(100),
    database.from("memories").select("id,category,content,confidence,user_verified,created_at").eq("owner_id", user.id).eq("person_id", personId).order("created_at", { ascending: false }).limit(100),
    database.from("commitments").select("id,description,commitment_owner,due_at,status,confidence").eq("owner_id", user.id).eq("person_id", personId).in("status", ["suggested", "open"]).order("due_at", { ascending: true, nullsFirst: false }).limit(50),
  ]);

  if (!person) notFound();
  const priority = Number(person.manual_priority ?? person.overall_priority ?? 0);
  const initials = String(person.display_name ?? "?").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  return <main className="page contact-profile-page" style={{ maxWidth: 980, margin: "0 auto" }}>
    <div className="contact-profile-toolbar"><BackToWorkspaceButton /><ContactProfileEditor person={person} /></div>
    <div className="person-detail">
      {mergedProfiles?.map(merge => <section className="card" key={merge.id}><h2>Bevarade uppgifter från sammanförd kontakt</h2>{Object.entries(merge.source_profile as Record<string, unknown>).filter(([key, value]) => ["display_name", "organization", "notes", "relationship_summary", "professional_specialty", "jurisdiction", "relationship_type"].includes(key) && value).map(([key,value]) => <p key={key}><strong>{key}</strong>: {String(value)}</p>)}</section>)}
      <div className="person-detail-head"><div className="avatar">{initials}</div><div><span className="eyebrow">Contact profile</span><h1 style={{ marginTop: 4 }}>{person.display_name}</h1><p className="subtitle">{[person.organization, person.relationship_type].filter(Boolean).join(" · ") || "Unified person profile"}</p></div></div>
      <div className="person-metrics" style={{ marginTop: 18 }}><div className="summary-stat"><strong>{priority || "–"}</strong><span>priority</span></div><div className="summary-stat"><strong>{identities?.length ?? 0}</strong><span>identities</span></div><div className="summary-stat"><strong>{conversations?.length ?? 0}</strong><span>conversations</span></div><div className="summary-stat"><strong>{commitments?.length ?? 0}</strong><span>open loops</span></div></div>

      <div className="person-detail-grid" style={{ marginTop: 18 }}>
        <section className="card"><div className="intel-label">Person intelligence</div>{person.relationship_summary && <p>{person.relationship_summary}</p>}{person.notes && <p className="muted">{person.notes}</p>}<div className="person-stack"><div className="person-fact"><strong>Relationship</strong><span>{person.relationship_type || "unknown"}</span></div><div className="person-fact"><strong>Organization</strong><span>{person.organization || "—"}</span></div><div className="person-fact"><strong>Specialty</strong><span>{person.professional_specialty || "—"}</span></div><div className="person-fact"><strong>Jurisdiction</strong><span>{person.jurisdiction || "—"}</span></div><div className="person-fact"><strong>First contact</strong><span>{person.first_contact_at ? new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(person.first_contact_at)) : "—"}</span></div><div className="person-fact"><strong>Last contact</strong><span>{person.last_contact_at ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(person.last_contact_at)) : "—"}</span></div></div></section>

        <section className="card"><div className="intel-label">Identities & channels</div>{(identities ?? []).length === 0 ? <p className="muted">No channel identities linked yet.</p> : <div className="person-stack">{identities?.map((identity) => <div className="person-fact" key={identity.id}><strong>{identity.source}</strong><span>{identity.username || identity.external_identifier}{identity.verified_match ? " · verified" : ""}</span></div>)}</div>}</section>
      </div>

      <div className="section-title">Conversation history</div>{(conversations ?? []).length === 0 ? <div className="empty-card">No conversations linked to this person yet.</div> : <div className="list">{conversations?.map((conversation) => <div className="list-row" key={conversation.id}><div className="avatar">{String(conversation.source).slice(0, 2).toUpperCase()}</div><div><strong>{conversation.title || "Untitled conversation"}</strong><small>{conversation.source}</small></div><div><span>{conversation.summary || "No summary yet."}</span><small>{conversation.last_message_at ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(conversation.last_message_at)) : "No message time"}</small></div><div>{conversation.priority_score != null && <span className="score">{Number(conversation.priority_score)}</span>}</div></div>)}</div>}

      <div className="section-title">Memory</div>{(memories ?? []).length === 0 ? <div className="empty-card">No saved person memories yet.</div> : <div className="learning-list">{memories?.map((memory) => <article className="learning-card" key={memory.id}><div className="learning-card-head"><span className="pill">{memory.category}</span><small>{Math.round(Number(memory.confidence ?? 0) * 100)}% confidence</small></div><p>{memory.content}</p><small className={memory.user_verified ? "positive" : "muted"}>{memory.user_verified ? "Verified by you" : "Awaiting verification"}</small></article>)}</div>}

      <div className="section-title">Open commitments</div>{(commitments ?? []).length === 0 ? <div className="empty-card">No open commitments with this person.</div> : <div className="list">{commitments?.map((item) => <div className="list-row" key={item.id}><div className="avatar">✓</div><div><strong>{item.commitment_owner === "user" ? "You" : item.commitment_owner === "sender" ? person.display_name : "Unclear owner"}</strong><small>{item.status}</small></div><div><span>{item.description}</span><small>{item.due_at ? new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(item.due_at)) : "No due date"}</small></div><div><span className="pill">{Math.round(Number(item.confidence ?? 0) * 100)}%</span></div></div>)}</div>}
    </div>
  </main>;
}
