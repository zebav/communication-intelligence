import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshRelationshipIntelligence } from "@/lib/relationship-intelligence-service";
import { logOperation } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  if (!isAuthorizedCron(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const database = createAdminClient();
  const { data: job } = await database.from("relationship_backfill_jobs").select("id,owner_id,cursor_person_id,status,processed_people,skipped_people,total_people").in("status", ["pending", "running"]).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (!job) return NextResponse.json({ ok: true, processed: 0, idle: true });
  if (job.status === "pending") await database.from("relationship_backfill_jobs").update({
    status: "running", current_stage: "qualifying_people", started_at: new Date().toISOString(), updated_at: new Date().toISOString(), error: null, last_error_code: null,
  }).eq("id", job.id);
  let query = database.from("people").select("id").eq("owner_id", job.owner_id).eq("entity_type", "person").order("id", { ascending: true }).limit(8);
  if (job.cursor_person_id) query = query.gt("id", job.cursor_person_id);
  const { data: people, error } = await query;
  if (error) {
    await database.from("relationship_backfill_jobs").update({ status: "failed", current_stage: "failed", error: "people_unavailable", last_error_code: "people_unavailable", updated_at: new Date().toISOString() }).eq("id", job.id);
    return NextResponse.json({ error: "People could not be loaded." }, { status: 500 });
  }
  const results = await Promise.allSettled((people ?? []).map((person: { id: string }) => refreshRelationshipIntelligence(database, job.owner_id, person.id)));
  const processed = results.filter((result) => result.status === "fulfilled").length;
  const skipped = results.filter((result) => result.status === "fulfilled" && result.value.updated === 0).length;
  const last = people?.at(-1)?.id ?? job.cursor_person_id;
  const completed = (people?.length ?? 0) < 8;
  await database.from("relationship_backfill_jobs").update({
    cursor_person_id: last,
    processed_people: Number(job.processed_people ?? 0) + processed,
    skipped_people: Number(job.skipped_people ?? 0) + skipped,
    evidence_watermark: new Date().toISOString(),
    status: completed ? "completed" : "running",
    current_stage: completed ? "completed" : "scoring",
    completed_at: completed ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("id", job.id);
  logOperation({ route: "/api/cron/relationship-backfill", operation: "relationship_backfill", outcome: "completed", durationMs: Date.now() - startedAt, requestId: request.headers.get("x-vercel-id"), counts: { processed, skipped, remainingBatch: people?.length ?? 0 } });
  return NextResponse.json({ ok: true, processed, skipped, total: job.total_people ?? null, completed });
}
