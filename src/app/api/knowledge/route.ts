import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { deleteKnowledgeEntry, knowledgeEntryInputSchema, knowledgeEntryUpdateSchema, listKnowledgeEntries, updateKnowledgeEntry, upsertKnowledgeEntry } from "@/lib/personal-knowledge";

const deleteSchema = z.object({ id: z.string().uuid() });

async function sessionUser() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Your session has expired. Sign in again." }, { status: 401 }) };
  const { data: assurance } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return { error: NextResponse.json({ error: "Two-factor authentication is required." }, { status: 403 }) };
  return { user, db };
}

function sameOrigin(request: NextRequest) {
  return request.headers.get("origin") === request.nextUrl.origin;
}

export async function GET() {
  const session = await sessionUser();
  if ("error" in session) return session.error;
  try {
    const entries = await listKnowledgeEntries(session.user.id);
    return NextResponse.json({ entries: entries.map((entry) => {
      const secret = entry.category === "credentials" || entry.metadata?.secret === true;
      return {
        ...entry,
        value: secret ? "" : entry.value,
        hasValue: Boolean(entry.value),
        masked: secret,
      };
    }) });
  } catch (error) {
    console.error("knowledge_vault_list_failed", { reason: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "The knowledge vault could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await sessionUser();
  if ("error" in session) return session.error;
  const parsed = knowledgeEntryInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the knowledge entry fields." }, { status: 400 });
  try {
    const result = await upsertKnowledgeEntry(session.user.id, parsed.data);
    await session.db.from("audit_logs").insert({
      owner_id: session.user.id, actor_id: session.user.id, actor_type: "user",
      action: "knowledge.upserted", object_type: "knowledge_entry", object_id: result.id,
      source: "manual", new_value: { category: parsed.data.category, key: parsed.data.key, sensitivity: parsed.data.sensitivity, allowed_uses: parsed.data.allowedUses },
    });
    return NextResponse.json({ success: true, id: result.id });
  } catch (error) {
    console.error("knowledge_vault_save_failed", { reason: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "The knowledge entry could not be saved." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await sessionUser();
  if ("error" in session) return session.error;
  const parsed = knowledgeEntryUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the knowledge entry fields." }, { status: 400 });
  try {
    const result = await updateKnowledgeEntry(session.user.id, parsed.data);
    await session.db.from("audit_logs").insert({ owner_id: session.user.id, actor_id: session.user.id, actor_type: "user", action: "knowledge.updated", object_type: "knowledge_entry", object_id: result.id, source: "manual", new_value: { category: parsed.data.category, key: parsed.data.key, sensitivity: parsed.data.sensitivity, allowed_uses: parsed.data.allowedUses } });
    return NextResponse.json({ success: true, id: result.id });
  } catch (error) {
    console.error("knowledge_vault_update_failed", { reason: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "The knowledge entry could not be updated." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await sessionUser();
  if ("error" in session) return session.error;
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid knowledge entry." }, { status: 400 });
  try {
    await deleteKnowledgeEntry(session.user.id, parsed.data.id);
    await session.db.from("audit_logs").insert({
      owner_id: session.user.id, actor_id: session.user.id, actor_type: "user",
      action: "knowledge.deleted", object_type: "knowledge_entry", object_id: parsed.data.id, source: "manual",
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("knowledge_vault_delete_failed", { reason: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "The knowledge entry could not be deleted." }, { status: 500 });
  }
}
