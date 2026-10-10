import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const AUTOMATION_OPERATIONS = [
  "gmail_intelligence",
  "outlook_intelligence",
  "instagram_intelligence",
  "whatsapp_intelligence",
  "slack_intelligence",
  "calendar_sync",
  "vault_ingestion",
  "relationship_backfill",
  "autonomous_learning",
  "follow_up_detection",
  "notification_orchestration",
] as const;

export type AutomationOperation = typeof AUTOMATION_OPERATIONS[number];
export type AutomationTrigger = "login" | "scheduled" | "manual_recovery";
type AutomationStatus = "queued" | "running" | "retrying" | "completed" | "failed";
export type SafeWorkerResult = { accounts?: number; synced?: number; analyzed?: number };

type AutomationJob = {
  id: string;
  owner_id: string;
  operation: AutomationOperation;
  attempts: number;
  trace_id: string;
};

const MAX_ATTEMPTS = 3;
const COALESCE_WINDOW_MS = 5 * 60_000;
const STALE_RUNNING_MS = 3 * 60_000;

export function newTraceId() {
  return randomUUID();
}

export function traceIdFromHeaders(headers: Headers) {
  const value = headers.get("x-solvani-trace-id");
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : newTraceId();
}

/**
 * Keep the durable job log useful without copying provider responses into the
 * database. These bounded counters are sufficient to distinguish a genuine
 * mailbox pass from a 200 response that did not claim any account.
 */
export function safeWorkerResult(payload: unknown): SafeWorkerResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const result: SafeWorkerResult = {};
  for (const key of ["accounts", "synced", "analyzed"] as const) {
    const value = (payload as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000) result[key] = value;
  }
  return result;
}

/** Queue at most one run per owner, operation and five-minute window. */
export async function enqueueOwnerMaintenance(
  database: SupabaseClient,
  input: { ownerId: string; trigger: AutomationTrigger; traceId?: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const bucket = Math.floor(now.getTime() / COALESCE_WINDOW_MS);
  const traceId = input.traceId ?? newTraceId();
  const rows = AUTOMATION_OPERATIONS.map((operation) => ({
    owner_id: input.ownerId,
    operation,
    trigger: input.trigger,
    trace_id: traceId,
    idempotency_key: `${input.ownerId}:${operation}:${bucket}`,
    available_at: now.toISOString(),
  }));
  const { error } = await database.from("automation_jobs").upsert(rows, {
    onConflict: "owner_id,operation,idempotency_key",
    ignoreDuplicates: true,
  });
  if (error) throw error;
  return { traceId, queued: rows.length };
}

/**
 * A serverless worker can end after atomically claiming a job but before it
 * records a result. Reclaim only work that has outlived the function budget;
 * the same bounded retry policy prevents an invisible infinite loop.
 */
export async function reclaimStaleAutomationJobs(database: SupabaseClient, now = new Date()) {
  const staleBefore = new Date(now.getTime() - STALE_RUNNING_MS).toISOString();
  const { data, error } = await database
    .from("automation_jobs")
    .select("id,attempts")
    .eq("status", "running")
    .lt("updated_at", staleBefore)
    .limit(40);
  if (error) throw error;

  let retrying = 0;
  let failed = 0;
  for (const candidate of data ?? []) {
    const attempts = Number(candidate.attempts ?? 0);
    const nextStatus = staleAutomationStatusFor(attempts);
    const exhausted = nextStatus === "failed";
    const { error: updateError } = await database
      .from("automation_jobs")
      .update({
        status: nextStatus,
        available_at: now.toISOString(),
        completed_at: exhausted ? now.toISOString() : null,
        last_error_code: "worker_timeout",
        updated_at: now.toISOString(),
      })
      .eq("id", candidate.id)
      .eq("status", "running")
      .lt("updated_at", staleBefore);
    if (updateError) throw updateError;
    if (exhausted) failed += 1;
    else retrying += 1;
  }
  return { retrying, failed };
}

export async function claimAutomationJobs(database: SupabaseClient, limit = 8): Promise<AutomationJob[]> {
  const { data, error } = await database
    .from("automation_jobs")
    .select("id,owner_id,operation,attempts,trace_id")
    .in("status", ["queued", "retrying"])
    .lte("available_at", new Date().toISOString())
    .order("available_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  const claimed: AutomationJob[] = [];
  for (const candidate of data ?? []) {
    const { data: row, error: claimError } = await database
      .from("automation_jobs")
      .update({
        status: "running",
        attempts: Number(candidate.attempts ?? 0) + 1,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_error_code: null,
      })
      .eq("id", candidate.id)
      .in("status", ["queued", "retrying"])
      .select("id,owner_id,operation,attempts,trace_id")
      .maybeSingle();
    if (claimError) throw claimError;
    if (row) claimed.push(row as AutomationJob);
  }
  return claimed;
}

export async function completeAutomationJob(
  database: SupabaseClient,
  job: AutomationJob,
  input: { status: Extract<AutomationStatus, "completed" | "retrying" | "failed">; errorCode?: string; httpStatus?: number; result?: SafeWorkerResult },
) {
  const retrying = input.status === "retrying";
  const result = { ...(input.httpStatus == null ? {} : { http_status: input.httpStatus }), ...(input.result ?? {}) };
  const availableAt = retrying
    ? new Date(Date.now() + Math.min(15 * 60_000, 60_000 * 2 ** Math.max(0, job.attempts - 1))).toISOString()
    : new Date().toISOString();
  const { error } = await database
    .from("automation_jobs")
    .update({
      status: input.status,
      available_at: availableAt,
      completed_at: retrying ? null : new Date().toISOString(),
      last_error_code: input.errorCode ?? null,
      result,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("status", "running");
  if (error) throw error;
}

export function retryStatusFor(job: AutomationJob) {
  return job.attempts >= MAX_ATTEMPTS ? "failed" as const : "retrying" as const;
}

export function staleAutomationStatusFor(attempts: number) {
  return attempts >= MAX_ATTEMPTS ? "failed" as const : "retrying" as const;
}

export const automationOperationPath: Record<AutomationOperation, string> = {
  gmail_intelligence: "/api/cron/gmail-intelligence",
  outlook_intelligence: "/api/cron/outlook-intelligence",
  instagram_intelligence: "/api/cron/instagram-intelligence",
  whatsapp_intelligence: "/api/cron/whatsapp-intelligence",
  slack_intelligence: "/api/cron/slack-intelligence",
  calendar_sync: "/api/cron/calendar-sync",
  vault_ingestion: "/api/cron/vault-ingestion",
  relationship_backfill: "/api/cron/relationship-backfill",
  autonomous_learning: "/api/cron/autonomous-learning",
  follow_up_detection: "/api/cron/follow-up-detection",
  notification_orchestration: "/api/cron/notification-orchestration",
};
