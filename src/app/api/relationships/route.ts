import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { relationshipCategories, type RelationshipCategory } from "@/lib/relationship-intelligence";

export async function GET(request: NextRequest) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Din session har gått ut." }, { status: 401 });
  const { data: assurance } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.json({ error: "Tvåstegsverifiering krävs." }, { status: 403 });
  const requested = request.nextUrl.searchParams.get("category");
  const category = relationshipCategories.includes(requested as RelationshipCategory) ? requested as RelationshipCategory : "romantic";
  const [{ data: snapshots, error: snapshotError }, jobResult] = await Promise.all([
    db.from("relationship_snapshots").select("id,person_id,category,strength_score,quality_score,priority_score,ranking_score,trend,confidence,evidence_count,explanation,missing_information,snapshot_date").eq("owner_id", user.id).eq("category", category).order("snapshot_date", { ascending: false }).order("ranking_score", { ascending: false }).limit(500),
    db.from("relationship_backfill_jobs").select("status,processed_people,skipped_people,total_people,current_stage,error").eq("owner_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (snapshotError) return NextResponse.json({ error: "Relationsunderlaget kunde inte läsas." }, { status: 503 });
  // A source deployment can briefly reach the database before its additive
  // progress migration. Keep existing rankings readable during that window;
  // the owner only loses the optional progress detail until migration applies.
  let job = jobResult.data;
  if (jobResult.error) {
    const legacy = await db.from("relationship_backfill_jobs").select("status,processed_people,skipped_people,error").eq("owner_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    job = legacy.data ? { ...legacy.data, total_people: null, current_stage: null } : null;
  }
  const newest = new Map<string, NonNullable<typeof snapshots>[number]>();
  for (const snapshot of snapshots ?? []) if (!newest.has(snapshot.person_id)) newest.set(snapshot.person_id, snapshot);
  const ranked = [...newest.values()].filter((item) => Number(item.evidence_count) >= 3 || Number(item.confidence) >= .8).sort((a, b) => Number(b.ranking_score) - Number(a.ranking_score)).slice(0, 10);
  const ids = ranked.map((item) => item.person_id);
  const { data: people, error: peopleError } = ids.length ? await db.from("people").select("id,display_name,organization,last_contact_at,entity_type,relationship_type").eq("owner_id", user.id).in("id", ids) : { data: [], error: null };
  if (peopleError) return NextResponse.json({ error: "Kontakterna kunde inte läsas." }, { status: 503 });
  const byId = new Map((people ?? []).map((person) => [person.id, person]));
  const placeholderName = /^(instagram|whatsapp|slack) contact\s+\d+$/i;
  const isQualified = (snapshot: NonNullable<typeof snapshots>[number], person: NonNullable<typeof people>[number]) => {
    if (person.entity_type === "automated" || placeholderName.test(person.display_name)) return false;
    const evidenceCount = Number(snapshot.evidence_count);
    const confidence = Number(snapshot.confidence);
    const ownerConfirmed = Boolean(person.relationship_type && person.relationship_type !== "unknown");
    return ownerConfirmed || (evidenceCount >= 5 && confidence >= 0.5);
  };
  return NextResponse.json({
    category,
    job: job ? { status: job.status, processedPeople: job.processed_people, skippedPeople: job.skipped_people, totalPeople: job.total_people, stage: job.current_stage, error: job.error } : null,
    rows: ranked.flatMap((snapshot) => {
      const person = byId.get(snapshot.person_id);
      return person && isQualified(snapshot, person) ? [{ ...snapshot, person }] : [];
    }),
  }, { headers: { "Cache-Control": "no-store" } });
}
