import { NextResponse } from "next/server";
import { safeOperationFailureSummary } from "@/lib/operations-status";
import { createClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;
type ConnectionRow = {
  provider: string | null;
  status: string | null;
  health_status: string | null;
  last_sync_at: string | null;
  updated_at: string | null;
  account_identifier?: string | null;
  account_name?: string | null;
};

type AutomationRow = {
  operation: string | null;
  status: string | null;
  attempts: number | null;
  updated_at: string | null;
  last_error_code: string | null;
};

type SyncState = "current" | "delayed" | "unknown";

function syncState(lastSyncAt: string | null): SyncState {
  if (!lastSyncAt) return "unknown";
  const timestamp = new Date(lastSyncAt).getTime();
  if (!Number.isFinite(timestamp)) return "unknown";
  // Imports run every five minutes, but a provider can have a bounded retry
  // or temporary throttling. Show a useful warning only after 45 minutes.
  return Date.now() - timestamp > 45 * 60_000 ? "delayed" : "current";
}

function countByState(rows: Row[] | null, field = "state") {
  return (rows ?? []).reduce<Record<string, number>>((counts, row) => {
    const key = typeof row[field] === "string" ? row[field] : "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function latestAutomationByOperation(rows: AutomationRow[] | null) {
  const latest = new Map<string, AutomationRow>();
  for (const row of rows ?? []) {
    const operation = row.operation ?? "unknown";
    if (!latest.has(operation)) latest.set(operation, row);
  }
  return [...latest.entries()].map(([operation, row]) => ({
    operation,
    status: row.status ?? "unknown",
    attempts: Number(row.attempts ?? 0),
    updatedAt: row.updated_at,
    error: row.last_error_code ? safeOperationFailureSummary(row.last_error_code) : null,
  }));
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

  const [connections, media, scheduled, calendar, browser, relationshipResult, automation] = await Promise.all([
    db.from("connections").select("provider,status,health_status,last_sync_at,updated_at,account_identifier,account_name").eq("owner_id", user.id).order("updated_at", { ascending: false }).limit(40),
    db.from("vault_ingestion_jobs").select("state,attempts,created_at,updated_at,last_error_code").eq("owner_id", user.id).order("updated_at", { ascending: false }).limit(80),
    db.from("scheduled_messages").select("status,scheduled_for,updated_at,last_error").eq("owner_id", user.id).order("updated_at", { ascending: false }).limit(80),
    db.from("calendar_sync_jobs").select("last_attempt_at,last_success_at,last_error,next_run_at").eq("owner_id", user.id).order("last_attempt_at", { ascending: false }).limit(40),
    db.from("assistant_browser_agent_runs").select("status,created_at,updated_at").eq("owner_id", user.id).order("updated_at", { ascending: false }).limit(80),
    db.from("relationship_backfill_jobs").select("status,current_stage,processed_people,skipped_people,total_people,error,updated_at").eq("owner_id", user.id).order("created_at", { ascending: false }).limit(3),
    db.from("automation_jobs").select("operation,status,attempts,updated_at,last_error_code,trace_id").eq("owner_id", user.id).order("updated_at", { ascending: false }).limit(80),
  ]);

  // Keep Operations truthful while an additive relationship-progress migration
  // is rolling out. A missing optional progress column must not hide the
  // durable job's actual state from its owner.
  let relationshipRows = relationshipResult.data;
  let relationshipUnavailable = Boolean(relationshipResult.error);
  if (relationshipResult.error) {
    const legacy = await db.from("relationship_backfill_jobs").select("status,processed_people,skipped_people,error,updated_at").eq("owner_id", user.id).order("created_at", { ascending: false }).limit(3);
    if (!legacy.error) {
      relationshipRows = legacy.data?.map((row) => ({ ...row, current_stage: null, total_people: null })) ?? [];
      relationshipUnavailable = false;
    }
  }
  const unavailable = [media, scheduled, calendar, browser, automation].filter((result) => result.error).length + Number(relationshipUnavailable);
  return NextResponse.json({
    connections: {
      total: connections.data?.length ?? 0,
      states: countByState((connections.data ?? []) as Row[], "status"),
      attention: (connections.data ?? []).filter((item) => item.status !== "connected" || item.health_status === "degraded" || item.health_status === "error" || item.health_status === "reconnect_required").length,
      latestSyncAt: (connections.data ?? []).map((item) => item.last_sync_at).filter((value): value is string => typeof value === "string").sort().at(-1) ?? null,
      accounts: ((connections.data ?? []) as ConnectionRow[]).map((item) => ({
        provider: item.provider ?? "unknown",
        account: item.account_identifier ?? item.account_name ?? "Anslutet konto",
        status: item.status ?? "unknown",
        health: item.health_status ?? "unknown",
        lastSyncAt: item.last_sync_at,
        syncState: syncState(item.last_sync_at),
      })),
    },
    media: { states: countByState((media.data ?? []) as Row[]), recentFailures: (media.data ?? []).filter((item) => item.state === "failed" || item.state === "dead_letter").slice(0, 5).map((item) => ({ at: item.updated_at, code: safeOperationFailureSummary(typeof item.last_error_code === "string" ? item.last_error_code : null), terminal: item.state === "dead_letter" })) },
    scheduled: { states: countByState((scheduled.data ?? []) as Row[], "status"), recentFailures: (scheduled.data ?? []).filter((item) => item.status === "failed" || item.status === "needs_review").slice(0, 5).map((item) => ({ at: item.updated_at, code: safeOperationFailureSummary(typeof item.last_error === "string" ? item.last_error : null) })) },
    calendar: { total: calendar.data?.length ?? 0, successful: (calendar.data ?? []).filter((item) => Boolean(item.last_success_at)).length, failed: (calendar.data ?? []).filter((item) => Boolean(item.last_error)).length, nextRunAt: (calendar.data ?? []).map((item) => item.next_run_at).filter((value): value is string => typeof value === "string").sort().at(0) ?? null },
    browser: { states: countByState((browser.data ?? []) as Row[], "status") },
    relationships: {
      states: countByState((relationshipRows ?? []) as Row[], "status"),
      latest: (relationshipRows ?? [])[0] ?? null,
    },
    automation: {
      // Automation jobs use `status` (unlike the media job table's `state`).
      // Reading the wrong field made a healthy queue appear as “unknown” in
      // Operations and hid the retry/completed split from the owner.
      states: countByState((automation.data ?? []) as Row[], "status"),
      latestByOperation: latestAutomationByOperation((automation.data ?? []) as AutomationRow[]),
      recentRecoveries: (automation.data ?? []).filter((item) => item.status === "completed" && Number(item.attempts ?? 0) > 1).slice(0, 5).map((item) => ({
        at: item.updated_at,
        operation: typeof item.operation === "string" ? item.operation : "unknown",
        attempts: Number(item.attempts ?? 0),
      })),
      recentFailures: (automation.data ?? []).filter((item) => item.status === "failed").slice(0, 5).map((item) => ({
        at: item.updated_at,
        operation: typeof item.operation === "string" ? item.operation : "unknown",
        code: safeOperationFailureSummary(typeof item.last_error_code === "string" ? item.last_error_code : null),
      })),
    },
    partial: unavailable > 0,
    generatedAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
