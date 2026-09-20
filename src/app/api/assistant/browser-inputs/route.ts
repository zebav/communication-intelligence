import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { browserFieldStates, saveBrowserField } from "@/lib/assistant/browser-private-fields";
import { readTask } from "@/lib/assistant/repository";

const querySchema = z.object({ taskId: z.string().uuid() });
const saveSchema = z.object({
  taskId: z.string().uuid(),
  revision: z.number().int().positive(),
  key: z.string().trim().min(1).max(80),
  value: z.string().min(1).max(20_000),
});

async function session() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Din session har gått ut. Logga in igen." }, { status: 401 }) };
  const { data: assurance } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return { error: NextResponse.json({ error: "Tvåfaktorsinloggning krävs." }, { status: 403 }) };
  return { db, owner: user.id };
}

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({ taskId: request.nextUrl.searchParams.get("taskId") });
  if (!parsed.success) return NextResponse.json({ error: "Välj en giltig webbuppgift." }, { status: 400 });
  const auth = await session();
  if ("error" in auth) return auth.error;
  try {
    const task = await readTask(auth.db, auth.owner, parsed.data.taskId);
    if (task.kind !== "website") return NextResponse.json({ error: "Uppgiften är inte en webbåtgärd." }, { status: 409 });
    const fields = await browserFieldStates(auth.owner, task);
    return NextResponse.json({
      fields: fields.map((field) => ({
        key: field.key,
        label: field.label,
        kind: field.kind,
        description: field.description,
        sensitivity: field.sensitivity,
        persist: field.persist,
        hasValue: field.hasValue,
        source: field.source,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Privata uppgifter kunde inte läsas." }, { status: 409 });
  }
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Ogiltigt ursprung." }, { status: 403 });
  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Kontrollera uppgiften." }, { status: 400 });
  const auth = await session();
  if ("error" in auth) return auth.error;
  try {
    const task = await readTask(auth.db, auth.owner, parsed.data.taskId);
    if (task.kind !== "website" || task.revision !== parsed.data.revision || !["decision","ready","waiting"].includes(task.status)) {
      return NextResponse.json({ error: "Webbuppgiften har ändrats. Hämta den senaste versionen först." }, { status: 409 });
    }
    const result = await saveBrowserField(auth.owner, task, { key: parsed.data.key, value: parsed.data.value });
    await auth.db.from("audit_logs").insert({
      owner_id: auth.owner,
      actor_id: auth.owner,
      actor_type: "user",
      action: "browser.private_field_saved",
      object_type: "knowledge_entry",
      object_id: result.id,
      source: "manual",
      new_value: { task_id: task.id, field_key: parsed.data.key },
    });
    return NextResponse.json({ success: true, id: result.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Uppgiften kunde inte sparas." }, { status: 409 });
  }
}
