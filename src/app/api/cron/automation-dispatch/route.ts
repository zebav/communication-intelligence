import { NextResponse, type NextRequest } from "next/server";
import {
  automationOperationPath,
  claimAutomationJobs,
  completeAutomationJob,
  retryStatusFor,
} from "@/lib/automation-jobs";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { logOperation } from "@/lib/observability";
import { createAdminClient } from "@/lib/supabase/admin";
import { ownerAgentForAutomation } from "@/lib/agents/registry";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  const jobs = await claimAutomationJobs(database);
  const results = await Promise.all(jobs.map(async (job) => {
    try {
      const response = await fetch(new URL(automationOperationPath[job.operation], request.url), {
        headers: {
          authorization: request.headers.get("authorization") ?? "",
          "x-owner-id": job.owner_id,
          "x-maintenance-trigger": "queued",
          "x-solvani-trace-id": job.trace_id,
        },
        signal: AbortSignal.timeout(50_000),
      });
      if (response.ok) {
        await completeAutomationJob(database, job, { status: "completed", httpStatus: response.status });
        return { operation: job.operation, agent: ownerAgentForAutomation(job.operation), state: "completed" as const };
      }
      const status = retryStatusFor(job);
      await completeAutomationJob(database, job, { status, errorCode: `worker_http_${response.status}`, httpStatus: response.status });
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
    counts: { claimed: jobs.length, completed: results.filter((result) => result.state === "completed").length, retrying: results.filter((result) => result.state === "retrying").length, failed },
  });
  return NextResponse.json({ ok: true, claimed: jobs.length, results }, { headers: { "Cache-Control": "no-store" } });
}
