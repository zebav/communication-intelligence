import { NextResponse, type NextRequest } from "next/server";
import {
  automationOperationPath,
  claimAutomationJobs,
  completeAutomationJob,
  reclaimStaleAutomationJobs,
  retryStatusFor,
  safeWorkerResult,
} from "@/lib/automation-jobs";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { logOperation } from "@/lib/observability";
import { createAdminClient } from "@/lib/supabase/admin";
import { ownerAgentForAutomation } from "@/lib/agents/registry";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function mailboxProvider(operation: string) {
  if (operation === "gmail_intelligence") return "gmail";
  if (operation === "outlook_intelligence") return "microsoft-graph";
  return null;
}

/**
 * Executes bounded, idempotent maintenance requests queued by a signed-in
 * owner. The direct source crons remain as a recovery path while this queue
 * is rolled out, so a failed dispatch never stops routine imports.
 */
export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  if (!isAuthorizedCron(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const database = createAdminClient();
  const reclaimed = await reclaimStaleAutomationJobs(database);
  const jobs = await claimAutomationJobs(database);
  const results = await Promise.all(jobs.map(async (job) => {
    try {
      const response = await fetch(new URL(automationOperationPath[job.operation], request.url), {
        // Every queued run must reach the source worker. Reusing a previous
        // internal GET response makes a healthy HTTP status look like a fresh
        // mailbox pass while no provider request or cursor update occurred.
        // Cron routes are explicitly dynamic, but setting this here makes the
        // worker-to-worker boundary unambiguous as well.
        cache: "no-store",
        headers: {
          authorization: request.headers.get("authorization") ?? "",
          "x-owner-id": job.owner_id,
          "x-maintenance-trigger": "queued",
          "x-solvani-trace-id": job.trace_id,
        },
        signal: AbortSignal.timeout(50_000),
      });
      const payload = await response.json().catch(() => null) as { errorCode?: unknown } | null;
      const result = safeWorkerResult(payload);
      if (response.ok) {
        // A mailbox worker returning 200 with no claimed account is not a
        // successful owner-maintenance pass when an account is connected. It
        // previously made Operations say "Klar" for stale Gmail/Outlook
        // inboxes. Retry through the durable backoff instead of hiding it.
        const provider = mailboxProvider(job.operation);
        const expected = provider
          ? await database.from("connections").select("id", { count: "exact", head: true }).eq("owner_id", job.owner_id).eq("provider", provider).eq("status", "connected")
          : null;
        const expectedMailboxCount = expected?.count ?? 0;
        // A valid source-worker response always includes its bounded account
        // count. Treat a missing counter exactly like zero work: it usually
        // means the internal request returned a non-worker response (for
        // example an HTML/error boundary) that happened to carry HTTP 200.
        // Completing that job would again mask stale mailboxes as healthy.
        const missingMailboxPass = Boolean(provider && !expected?.error && expectedMailboxCount > 0 && (result.accounts == null || result.accounts === 0));
        if (missingMailboxPass) {
          const status = retryStatusFor(job);
          await completeAutomationJob(database, job, {
            status,
            errorCode: result.accounts == null ? "mailbox_sync_unverified" : "mailbox_sync_no_accounts",
            httpStatus: response.status,
            result,
          });
          return { operation: job.operation, agent: ownerAgentForAutomation(job.operation), state: status };
        }
        await completeAutomationJob(database, job, { status: "completed", httpStatus: response.status, result });
        return { operation: job.operation, agent: ownerAgentForAutomation(job.operation), state: "completed" as const };
      }
      const status = retryStatusFor(job);
      // Workers expose only allowlisted, provider-neutral diagnostic codes. Do
      // not persist raw upstream error bodies into the owner-facing job log.
      const errorCode = typeof payload?.errorCode === "string" && /^[a-z0-9_]{3,80}$/.test(payload.errorCode)
        ? payload.errorCode
        : `worker_http_${response.status}`;
      await completeAutomationJob(database, job, { status, errorCode, httpStatus: response.status, result });
      return { operation: job.operation, agent: ownerAgentForAutomation(job.operation), state: status };
    } catch {
      const status = retryStatusFor(job);
      await completeAutomationJob(database, job, { status, errorCode: "worker_unavailable" });
      return { operation: job.operation, agent: ownerAgentForAutomation(job.operation), state: status };
    }
  }));

  const failed = results.filter((result) => result.state === "failed").length;
  logOperation({
    route: "/api/cron/automation-dispatch",
    operation: "dispatch_owner_maintenance",
    outcome: failed ? "failed" : "completed",
    durationMs: Date.now() - startedAt,
    requestId: request.headers.get("x-vercel-id"),
    counts: { claimed: jobs.length, completed: results.filter((result) => result.state === "completed").length, retrying: results.filter((result) => result.state === "retrying").length, failed, recovered_stale: reclaimed.retrying, stale_failed: reclaimed.failed },
  });
  return NextResponse.json({ ok: true, claimed: jobs.length, recovered: reclaimed, results }, { headers: { "Cache-Control": "no-store" } });
}
