import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { ownerIdFromCronHeaders } from "@/lib/cron-owner";
import { logOperation } from "@/lib/observability";
import { createAdminClient } from "@/lib/supabase/admin";
import { makePlan } from "@/lib/assistant/model";
import { readEvidence } from "@/lib/assistant/repository";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Turns already-evidenced, unresolved communication outcomes into an owner
 * decision card. It does not generate a costly draft or contact any provider:
 * the owner opens the card to prepare and approve the exact follow-up.
 */
export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  if (!isAuthorizedCron(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const database = createAdminClient();
  const ownerId = ownerIdFromCronHeaders(request.headers);
  let query = database.from("communication_outcomes")
    .select("owner_id,trigger_message_id,conversation_id,updated_at")
    .eq("status", "follow_up_needed")
    .order("updated_at", { ascending: true })
    .limit(16);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { data: outcomes, error } = await query;
  if (error) return NextResponse.json({ error: "Follow-up outcomes could not be read." }, { status: 503 });
  let created = 0;
  for (const outcome of outcomes ?? []) {
    const { data: existing } = await database.from("assistant_tasks").select("id")
      .eq("owner_id", outcome.owner_id).eq("message_id", outcome.trigger_message_id).eq("kind", "follow_up").maybeSingle();
    if (existing) continue;
    try {
      const evidence = await readEvidence(database, outcome.owner_id, outcome.trigger_message_id);
      if (evidence.direction !== "out" || (evidence.lastOtherAt && Date.parse(evidence.lastOtherAt) > Date.parse(evidence.sentAt))) continue;
      const plan = { ...makePlan(evidence, "follow_up"), reason: "Ett tidigare skickat meddelande saknar fortfarande svar. Solvani har förberett ett säkert uppföljningsbeslut; text och mottagare granskas innan utskick." };
      const { error: insertError } = await database.from("assistant_tasks").insert({ owner_id: outcome.owner_id, message_id: outcome.trigger_message_id, kind: "follow_up", plan });
      if (!insertError) created += 1;
    } catch {
      // A malformed legacy message is skipped; a later bounded pass can retry.
    }
  }
  logOperation({ route: "/api/cron/follow-up-detection", operation: "follow_up_detection", outcome: "completed", durationMs: Date.now() - startedAt, requestId: request.headers.get("x-vercel-id"), traceId: request.headers.get("x-solvani-trace-id"), counts: { scanned: outcomes?.length ?? 0, created } });
  return NextResponse.json({ ok: true, scanned: outcomes?.length ?? 0, created }, { headers: { "Cache-Control": "no-store" } });
}
