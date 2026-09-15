import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { contactMatch, type MatchPerson } from "@/lib/contact-matching";

async function context() {
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  const { data: aal } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!user || aal?.currentLevel !== "aal2") return null;
  return { db, user };
}
export async function GET() {
  const ctx = await context(); if (!ctx) return NextResponse.json({ error: "Logga in med tvåfaktor." }, { status: 401 });
  const { db, user } = ctx;
  const { data: merges, error } = await db.from("contact_merges").select("id,source_id,target_id,source_profile,created_at,automatic").eq("owner_id", user.id).is("undone_at", null).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Kontaktfunktionen kräver att databasmigrationen är installerad." }, { status: 503 });
  const people: MatchPerson[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error: readError } = await db.from("people").select("id,display_name,entity_type,identities(source,external_identifier,verified_match)").eq("owner_id", user.id).or("relationship_status.is.null,relationship_status.neq.merged").order("id").range(offset, offset + 499).abortSignal(AbortSignal.timeout(15000));
    if (readError) return NextResponse.json({ error: "Kontakterna kunde inte läsas." }, { status: 503 });
    people.push(...(data ?? []) as MatchPerson[]);
    if ((data?.length ?? 0) < 500) break;
  }
  // Index by exact normalized name or identity; never compare every pair globally.
  const groups = new Map<string, MatchPerson[]>();
  for (const p of people) {
    const keys = [`name:${p.display_name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()}`, ...p.identities.map(i => `${i.source}:${i.external_identifier.trim().toLowerCase()}`)];
    for (const key of new Set(keys)) groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const candidates = new Map<string, NonNullable<ReturnType<typeof contactMatch>>>();
  for (const group of groups.values()) for (let a = 0; a < group.length; a++) for (let b = a + 1; b < group.length; b++) {
    const match = contactMatch(group[a],group[b]);
    if (match) candidates.set(`${match.sourceId}:${match.targetId}`, { ...match, safe: match.safe && group.length === 2 });
  }
  return NextResponse.json({ candidates: [...candidates.values()], merges }, { headers: { "Cache-Control": "private, no-store" } });
}
const operation = z.discriminatedUnion("action", [z.object({ action: z.literal("merge"), source: z.string().uuid(), target: z.string().uuid(), automatic: z.boolean().default(false) }), z.object({ action: z.literal("undo"), id: z.string().uuid() })]);
export async function POST(request: Request) {
  const ctx = await context(); if (!ctx) return NextResponse.json({ error: "Logga in med tvåfaktor." }, { status: 401 });
  const parsed = operation.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ogiltig kontaktändring." }, { status: 400 });
  const p = parsed.data;
  const { error } = p.action === "undo" ? await ctx.db.rpc("undo_contact_merge_v3", { merge_id: p.id }) : await ctx.db.rpc("merge_contacts_v3", { source_person: p.source, target_person: p.target, auto_match: p.automatic });
  if (error) return NextResponse.json({ error: "Ändringen kunde inte genomföras. Kontakterna kan ha ändrats; uppdatera listan och försök igen." }, { status: 409 });
  return NextResponse.json({ success: true });
}
