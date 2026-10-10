import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { processPendingEmailMediaJobs } from "@/lib/media/email-worker";
import { logOperation } from "@/lib/observability";
import { ownerIdFromCronHeaders } from "@/lib/cron-owner";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  if (!isAuthorizedCron(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const database = createAdminClient();
  const ownerId = ownerIdFromCronHeaders(request.headers);
  try {
    // The dispatcher sends a scoped owner header for repair/retry jobs. The
    // scheduled cron intentionally omits it and processes a small fair slice
    // of the global queue, so one owner's backfill cannot dominate a run.
    const result = await processPendingEmailMediaJobs(database, 3, ownerId ?? undefined);
    logOperation({ route: "/api/cron/media-analysis", operation: "email_media_analysis", outcome: result.failed ? "failed" : "completed", durationMs: Date.now() - startedAt, requestId: request.headers.get("x-vercel-id"), traceId: request.headers.get("x-solvani-trace-id"), counts: { owner_scoped: ownerId ? 1 : 0, scanned: result.scanned, processed: result.processed, failed: result.failed }, error: result.failureCodes[0] });
    return NextResponse.json(result);
  } catch (error) {
    logOperation({ route: "/api/cron/media-analysis", operation: "email_media_analysis", outcome: "failed", durationMs: Date.now() - startedAt, requestId: request.headers.get("x-vercel-id"), traceId: request.headers.get("x-solvani-trace-id"), error });
    return NextResponse.json({ error: "Media queue could not be read." }, { status: 500 });
  }
}
