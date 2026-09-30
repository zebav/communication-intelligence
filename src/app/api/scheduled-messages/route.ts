import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const createSchema = z.object({ conversationId: z.string().uuid(), messageId: z.string().uuid(), body: z.string().trim().min(1).max(4096), scheduledFor: z.string().datetime({ offset: true }) });
const updateSchema = z.object({ id: z.string().uuid(), action: z.literal("cancel") });
const supported = new Set(["email", "instagram", "whatsapp"]);
function fail(error: string, status = 400) { return NextResponse.json({ error }, { status }); }
async function owner(db: Awaited<ReturnType<typeof createClient>>) { const { data: { user } } = await db.auth.getUser(); const { data: aal } = await db.auth.mfa.getAuthenticatorAssuranceLevel(); return user && aal?.currentLevel === "aal2" ? user : null; }

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return fail("Invalid request origin.", 403);
  const parsed = createSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return fail("Välj ett giltigt framtida datum och ett svar.");
  const due = Date.parse(parsed.data.scheduledFor); if (!Number.isFinite(due) || due < Date.now() + 60_000 || due > Date.now() + 90 * 24 * 60 * 60_000) return fail("Välj en tid mellan en minut och 90 dagar framåt.");
  const db = await createClient(); const user = await owner(db); if (!user) return fail("Tvåfaktorsinloggning krävs.", 403);
  const { data: conversation } = await db.from("conversations").select("id,source,connection_id,external_conversation_id").eq("id", parsed.data.conversationId).eq("owner_id", user.id).maybeSingle();
  if (!conversation || !supported.has(conversation.source)) return fail("Den här kanalen kan inte schemaläggas ännu.", 409);
  const { data: message } = await db.from("messages").select("id,sender_identity_id,direction,source,identities(external_identifier)").eq("id", parsed.data.messageId).eq("owner_id", user.id).eq("conversation_id", conversation.id).eq("direction", "in").maybeSingle();
  if (!message || message.source !== conversation.source) return fail("Originalmeddelandet kunde inte verifieras.", 409);
  const identity = Array.isArray(message.identities) ? message.identities[0] : message.identities;
  const recipient = conversation.source === "email" ? identity?.external_identifier ?? null : conversation.external_conversation_id?.split(":").at(-1) ?? null;
  const { data, error } = await db.from("scheduled_messages").insert({ owner_id: user.id, conversation_id: conversation.id, source_message_id: message.id, source: conversation.source, body_text: parsed.data.body, scheduled_for: new Date(due).toISOString(), expected_connection_id: conversation.connection_id, expected_recipient: recipient }).select("id,scheduled_for,status").single();
  if (error) return fail("Schemaläggningen kunde inte sparas.", 503);
  await db.from("audit_logs").insert({ owner_id: user.id, actor_id: user.id, action: "message.scheduled", object_type: "scheduled_message", object_id: data.id, source: conversation.source, actor_type: "user", new_value: { scheduled_for: data.scheduled_for, conversation_id: conversation.id } });
  return NextResponse.json({ success: true, item: data });
}

export async function PATCH(request: NextRequest) {
  const parsed = updateSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return fail("Ogiltig ändring.");
  const db = await createClient(); const user = await owner(db); if (!user) return fail("Tvåfaktorsinloggning krävs.", 403);
  const now = new Date().toISOString(); const { data, error } = await db.from("scheduled_messages").update({ status: "cancelled", cancelled_at: now, updated_at: now }).eq("id", parsed.data.id).eq("owner_id", user.id).eq("status", "scheduled").select("id").maybeSingle();
  if (error || !data) return fail("Utskicket kunde inte avbrytas. Det kan redan vara under kontroll.", 409);
  await db.from("audit_logs").insert({ owner_id: user.id, actor_id: user.id, action: "message.schedule_cancelled", object_type: "scheduled_message", object_id: data.id, actor_type: "user" });
  return NextResponse.json({ success: true });
}

export async function GET() {
  const db = await createClient(); const user = await owner(db); if (!user) return fail("Tvåfaktorsinloggning krävs.", 403);
  const { data, error } = await db.from("scheduled_messages").select("id,source,body_text,scheduled_for,status,last_error,conversations(title,people(display_name))").eq("owner_id", user.id).in("status", ["scheduled", "processing", "failed", "needs_review"]).order("scheduled_for", { ascending: true }).limit(100);
  if (error) return fail("Planerade utskick kunde inte hämtas.", 503);
  return NextResponse.json({ items: (data ?? []).map((row) => { const c = Array.isArray(row.conversations) ? row.conversations[0] : row.conversations; const p = Array.isArray(c?.people) ? c.people[0] : c?.people; return { id: row.id, source: row.source, body: row.body_text, scheduledFor: row.scheduled_for, status: row.status, error: row.last_error, title: c?.title ?? "Meddelande", person: p?.display_name ?? "Okänd mottagare" }; }) }, { headers: { "Cache-Control": "private, no-store" } });
}
