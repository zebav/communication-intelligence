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

type AutomationJob = {
  id: string;
  owner_id: string;
  operation: AutomationOperation;
  attempts: number;
  trace_id: string;
};

const MAX_ATTEMPTS = 3;
const COALESCE_WINDOW_MS = 5 * 60_000;

export function newTraceId() {
  return randomUUID();
}

export function traceIdFromHeaders(headers: Headers) {
  const value = headers.get("x-solvani-trace-id");
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : newTraceId();
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
  input: { status: Extract<AutomationStatus, "completed" | "retrying" | "failed">; errorCode?: string; httpStatus?: number },
) {
  const retrying = input.status === "retrying";
  const result = input.httpStatus == null ? {} : { http_status: input.httpStatus };
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
