import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createMobileClient } from "@/lib/supabase/mobile";
import { statuses, type TaskKind, type TaskStatus } from "@/lib/assistant/model";

/**
 * A deliberately small projection of the canonical assistant task. Inbox only
 * needs to know whether a message already has a persisted decision; the full
 * private plan remains in the decision workspace.
 */
type DecisionStatus = {
  id: string;
  message_id: string;
  kind: TaskKind;
  status: TaskStatus;
  revision: number;
  updated_at: string;
};

const messageIdsSchema = z.array(z.string().uuid()).min(1).max(100);
const taskStatusSchema = z.enum(statuses);

const json = (value: unknown, status = 200) => NextResponse.json(value, {
  status,
  headers: { "Cache-Control": "no-store" },
});

async function session(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  const db = token ? createMobileClient(token) : await createClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) throw new Error("Logga in igen.");
  const { data, error: aalError } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalError || data?.currentLevel !== "aal2") throw new Error("Tvåfaktorsinloggning krävs.");
  return { db, owner: user.id };
}

export async function GET(request: Request) {
  try {
    const ids = messageIdsSchema.parse(new URL(request.url).searchParams.getAll("messageId"));
    const { db, owner } = await session(request);
    const { data, error } = await db
      .from("assistant_tasks")
      .select("id,message_id,kind,status,revision,updated_at")
      .eq("owner_id", owner)
      .in("message_id", ids)
      .order("updated_at", { ascending: false });
    if (error) throw new Error("Beslutsstatus kunde inte läsas.");

    // A message can have distinct task kinds, but Inbox must point to one
    // deterministic current decision. The newest task is the same one shown
    // first in Notiscenter; no derived state is persisted here.
    const byMessage = new Map<string, DecisionStatus>();
    for (const row of data ?? []) {
      const parsed = taskStatusSchema.safeParse(row.status);
      if (!parsed.success || byMessage.has(row.message_id)) continue;
      byMessage.set(row.message_id, {
        id: row.id,
        message_id: row.message_id,
        kind: row.kind as TaskKind,
        status: parsed.data,
        revision: Number(row.revision),
        updated_at: row.updated_at,
      });
    }
    return json({ tasks: [...byMessage.values()] });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? "Välj minst ett och högst 100 giltiga meddelanden."
      : error instanceof Error ? error.message : "Beslutsstatus kunde inte läsas.";
    return json({ error: message }, message === "Logga in igen." ? 401 : message === "Tvåfaktorsinloggning krävs." ? 409 : 400);
  }
}
