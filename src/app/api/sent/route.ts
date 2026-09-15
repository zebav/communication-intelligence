import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sentStatus } from "@/lib/sent-status";
import { z } from "zod";

export async function PATCH(request: Request) {
  const parsed = z.object({ id: z.string().uuid(), expectsReply: z.boolean() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ogiltigt meddelande." }, { status: 400 });
  const db = await createClient(); const { data: { user } } = await db.auth.getUser(); const { data: aal } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!user || aal?.currentLevel !== "aal2") return NextResponse.json({ error: "Logga in med tvåfaktor." }, { status: 401 });
  const { error: saveError } = await db.rpc("set_expects_reply_v3", { outgoing_id: parsed.data.id, expects: parsed.data.expectsReply });
  return saveError ? NextResponse.json({ error: "Status kunde inte sparas." }, { status: 503 }) : NextResponse.json({ success: true });
}

const querySchema = z.object({ page: z.coerce.number().int().min(0).max(100000).default(0), person: z.string().trim().max(200).default(""), source: z.string().max(30).default(""), account: z.union([z.string().uuid(), z.literal("")]).default(""), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Kontrollera filtren." }, { status: 400 });
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Logga in igen." }, { status: 401 });
  const { data: aal } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") return NextResponse.json({ error: "Tvåfaktorsinloggning krävs." }, { status: 403 });
  const f = parsed.data;
  let query = db.from("messages").select("id,source,body_text,sent_at,metadata,conversations!inner(id,title,person_id,connection_id,last_other_message_at,people(display_name),connections(account_identifier,account_name))").eq("owner_id", user.id).eq("direction", "out");
  if (f.person) {
    const { data: people, error } = await db.from("people").select("id").eq("owner_id", user.id).ilike("display_name", `%${f.person.replace(/[%_]/g, "")}%`).limit(500);
    if (error) return NextResponse.json({ error: "Kontakterna kunde inte hämtas." }, { status: 503 });
    if (!people?.length) return NextResponse.json({ items: [], more: false });
    query = query.in("conversations.person_id", people.map(p => p.id));
  }
  if (f.source) query = query.eq("source", f.source);
  if (f.account) query = query.eq("conversations.connection_id", f.account);
  if (f.from) query = query.gte("sent_at", `${f.from}T00:00:00Z`);
  if (f.to) query = query.lte("sent_at", `${f.to}T23:59:59.999Z`);
  const { data, error } = await query.order("sent_at", { ascending: false }).order("id", { ascending: false }).range(f.page * 50, f.page * 50 + 50).abortSignal(AbortSignal.timeout(20_000));
  if (error) return NextResponse.json({ error: "Skickade meddelanden kunde inte hämtas. Försök igen." }, { status: 503 });
  const items = (data ?? []).slice(0, 50).map(row => {
    const c = Array.isArray(row.conversations) ? row.conversations[0] : row.conversations;
    const person = Array.isArray(c?.people) ? c.people[0] : c?.people;
    const account = Array.isArray(c?.connections) ? c.connections[0] : c?.connections;
    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};
    return { id: row.id, source: row.source, body: row.body_text, sentAt: row.sent_at, title: c?.title, personId: c?.person_id, person: person?.display_name ?? "Okänd mottagare", account: account?.account_identifier ?? account?.account_name ?? "Konto saknas", ...sentStatus(metadata, row.sent_at, c?.last_other_message_at) };
  });
  return NextResponse.json({ items, more: (data?.length ?? 0) > 50 }, { headers: { "Cache-Control": "private, no-store" } });
}
