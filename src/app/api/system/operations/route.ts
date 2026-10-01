import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

function countByState(rows: Row[] | null, field = "state") {
  return (rows ?? []).reduce<Record<string, number>>((counts, row) => {
    const key = typeof row[field] === "string" ? row[field] : "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

/**
 * Read-only, owner-scoped operations view. It deliberately returns compact
 * status data rather than message bodies, credentials, or third-party errors.
 */
export async function GET() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Din session har gått ut." }, { status: 401 });
  const { data: assurance } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.json({ error: "Tvåstegsverifiering krävs." }, { status: 403 });

  const [connections, media, scheduled, calendar, browser] = await Promise.all([
    db.from("connections").select("provider,status,health_status,last_sync_at,updated_at").eq("owner_id", user.id).order("updated_at", { ascending: false }).limit(40),
    db.from("vault_ingestion_jobs").select("state,attempts,created_at,updated_at,last_error_code").eq("owner_id", user.id).order("updated_at", { ascending: false }).limit(80),
    db.from("scheduled_messages").select("status,scheduled_for,updated_at,last_error").eq("owner_id", user.id).order("updated_at", { ascending: false }).limit(80),
    db.from("calendar_sync_jobs").select("last_attempt_at,last_success_at,last_error,next_run_at").eq("owner_id", user.id).order("last_attempt_at", { ascending: false }).limit(40),
    db.from("assistant_browser_agent_runs").select("status,created_at,updated_at").eq("owner_id", user.id).order("updated_at", { ascending: false }).limit(80),
  ]);

  const unavailable = [media, scheduled, calendar, browser].filter((result) => result.error).length;
  return NextResponse.json({
    connections: {
      total: connections.data?.length ?? 0,
      states: countByState((connections.data ?? []) as Row[], "status"),
      attention: (connections.data ?? []).filter((item) => item.status !== "connected" || item.health_status === "degraded" || item.health_status === "error").length,
      latestSyncAt: (connections.data ?? []).map((item) => item.last_sync_at).filter((value): value is string => typeof value === "string").sort().at(-1) ?? null,
    },
    media: { states: countByState((media.data ?? []) as Row[]), recentFailures: (media.data ?? []).filter((item) => item.state === "failed").slice(0, 5).map((item) => ({ at: item.updated_at, code: typeof item.last_error_code === "string" ? item.last_error_code.slice(0, 100) : "Kunde inte slutföras" })) },
    scheduled: { states: countByState((scheduled.data ?? []) as Row[], "status"), recentFailures: (scheduled.data ?? []).filter((item) => item.status === "failed" || item.status === "needs_review").slice(0, 5).map((item) => ({ at: item.updated_at, code: typeof item.last_error === "string" ? item.last_error.slice(0, 100) : "Behöver granskas" })) },
    calendar: { total: calendar.data?.length ?? 0, successful: (calendar.data ?? []).filter((item) => Boolean(item.last_success_at)).length, failed: (calendar.data ?? []).filter((item) => Boolean(item.last_error)).length, nextRunAt: (calendar.data ?? []).map((item) => item.next_run_at).filter((value): value is string => typeof value === "string").sort().at(0) ?? null },
    browser: { states: countByState((browser.data ?? []) as Row[], "status") },
    partial: unavailable > 0,
    generatedAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
