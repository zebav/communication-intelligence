import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { processPendingEmailMediaJobs } from "@/lib/media/email-worker";
import { logOperation } from "@/lib/observability";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  if (!isAuthorizedCron(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const database = createAdminClient();
  try {
    const result = await processPendingEmailMediaJobs(database, 3);
    logOperation({ route: "/api/cron/media-analysis", operation: "email_media_analysis", outcome: "completed", durationMs: Date.now() - startedAt, requestId: request.headers.get("x-vercel-id"), traceId: request.headers.get("x-solvani-trace-id") });
    return NextResponse.json(result);
  } catch (error) {
    logOperation({ route: "/api/cron/media-analysis", operation: "email_media_analysis", outcome: "failed", durationMs: Date.now() - startedAt, requestId: request.headers.get("x-vercel-id"), traceId: request.headers.get("x-solvani-trace-id"), error });
    return NextResponse.json({ error: "Media queue could not be read." }, { status: 500 });
  }
}
