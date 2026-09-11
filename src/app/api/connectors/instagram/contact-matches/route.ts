import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { confidentContactMatches } from "@/lib/connectors/contact-match";
import { createClient } from "@/lib/supabase/server";

const decisionSchema = z.object({ identityId: z.string().uuid(), candidatePersonId: z.string().uuid(), decision: z.enum(["approve", "reject"]) });
async function authenticatedDatabase() {
  const database = await createClient(); const { data: { user } } = await database.auth.getUser(); if (!user) return null;
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel(); if (assurance?.currentLevel !== "aal2") return null;
  return { database, user };
}

export async function GET() {
  const auth = await authenticatedDatabase(); if (!auth) return NextResponse.json({ error: "Sign in with two-factor authentication." }, { status: 401 });
  const { database, user } = auth;
  const [{ data: instagramIdentities }, { data: people }, { data: allIdentities }] = await Promise.all([
    database.from("identities").select("id,person_id,username,metadata,people(display_name)").eq("owner_id", user.id).eq("source", "instagram"),
    database.from("people").select("id,display_name,organization").eq("owner_id", user.id).eq("entity_type", "person").limit(1000),
    database.from("identities").select("person_id,external_identifier,username").eq("owner_id", user.id).limit(2000),
  ]);
  const candidates = (people ?? []).map((person) => ({ id: person.id, name: person.display_name ?? "", organization: person.organization ?? "", identifiers: (allIdentities ?? []).filter((identity) => identity.person_id === person.id).flatMap((identity) => [identity.external_identifier, identity.username ?? ""]).filter(Boolean) }));
  const suggestions = (instagramIdentities ?? []).flatMap((identity) => {
    const linkedPerson = Array.isArray(identity.people) ? identity.people[0] : identity.people; const metadata = identity.metadata && typeof identity.metadata === "object" && !Array.isArray(identity.metadata) ? identity.metadata as Record<string, unknown> : {};
    if (metadata.contact_match_review === "rejected" || metadata.contact_match_review === "approved") return [];
    const instagramName = String(metadata.profile_name ?? linkedPerson?.display_name ?? ""); const username = identity.username ?? String(metadata.username ?? "");
    return confidentContactMatches(instagramName, username, candidates.filter((candidate) => candidate.id !== identity.person_id)).map((match) => ({ identityId: identity.id, sourcePersonId: identity.person_id, instagramName, username, candidatePersonId: match.candidate.id, candidateName: match.candidate.name, candidateOrganization: match.candidate.organization, confidence: match.confidence }));
  });
  return NextResponse.json({ suggestions: suggestions.slice(0, 50) });
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = decisionSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: "Choose a valid contact suggestion." }, { status: 400 });
  const auth = await authenticatedDatabase(); if (!auth) return NextResponse.json({ error: "Sign in with two-factor authentication." }, { status: 401 }); const { database, user } = auth;
  const [{ data: identity }, { data: target }] = await Promise.all([database.from("identities").select("id,person_id,metadata").eq("id", parsed.data.identityId).eq("owner_id", user.id).eq("source", "instagram").maybeSingle(), database.from("people").select("id,display_name").eq("id", parsed.data.candidatePersonId).eq("owner_id", user.id).maybeSingle()]);
  if (!identity || !target || identity.person_id === target.id) return NextResponse.json({ error: "The contact suggestion is no longer available." }, { status: 404 });
  const metadata = identity.metadata && typeof identity.metadata === "object" && !Array.isArray(identity.metadata) ? identity.metadata as Record<string, unknown> : {};
  if (parsed.data.decision === "reject") {
    await database.from("identities").update({ metadata: { ...metadata, contact_match_review: "rejected", rejected_person_id: target.id } }).eq("id", identity.id).eq("owner_id", user.id);
  } else {
    const { data: conversations } = await database.from("conversations").select("id").eq("owner_id", user.id).eq("person_id", identity.person_id).eq("source", "instagram");
    const conversationIds = (conversations ?? []).map((item) => item.id);
    await database.from("identities").update({ person_id: target.id, verified_match: true, confidence: 1, metadata: { ...metadata, contact_match_review: "approved", previous_person_id: identity.person_id } }).eq("id", identity.id).eq("owner_id", user.id);
    if (conversationIds.length) { await database.from("conversations").update({ person_id: target.id, updated_at: new Date().toISOString() }).eq("owner_id", user.id).in("id", conversationIds); await database.from("memories").update({ person_id: target.id }).eq("owner_id", user.id).in("conversation_id", conversationIds); await database.from("commitments").update({ person_id: target.id }).eq("owner_id", user.id).in("conversation_id", conversationIds); }
  }
  await database.from("audit_logs").insert({ owner_id: user.id, actor_id: user.id, action: `instagram.contact_match_${parsed.data.decision}d`, object_type: "identity", object_id: identity.id, source: "instagram", actor_type: "user", previous_value: { person_id: identity.person_id }, new_value: { candidate_person_id: target.id, candidate_name: target.display_name } });
  return NextResponse.json({ success: true });
}
