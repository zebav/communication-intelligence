import { NextRequest, NextResponse } from "next/server";
import { enqueueOwnerMaintenance, newTraceId } from "@/lib/automation-jobs";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logOperation } from "@/lib/observability";

// The workspace must remain quick even when a mailbox has a large backlog.
// This authenticated endpoint acknowledges the login immediately, then starts
// the bounded maintenance run after the response has been sent.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) {
    logOperation({ route: "/api/system/automation", operation: "start_maintenance", outcome: "failed", durationMs: Date.now() - startedAt, requestId: request.headers.get("x-vercel-id"), error: "unauthenticated" });
    return NextResponse.json({ error: "Din session har gått ut." }, { status: 401 });
  }
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.json({ error: "Tvåstegsverifiering krävs." }, { status: 403 });
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Ogiltigt ursprung." }, { status: 403 });

  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    logOperation({ route: "/api/system/automation", operation: "start_maintenance", outcome: "failed", durationMs: Date.now() - startedAt, requestId: request.headers.get("x-vercel-id"), error: "automation_not_configured" });
    return NextResponse.json({ queued: false, reason: "automation_not_configured" }, { status: 202 });
  }

  const ownerId = user.id;
  const traceId = newTraceId();
  try {
    const queued = await enqueueOwnerMaintenance(createAdminClient(), { ownerId, trigger: "login", traceId });
    logOperation({ route: "/api/system/automation", operation: "queue_maintenance", outcome: "queued", durationMs: Date.now() - startedAt, requestId: request.headers.get("x-vercel-id"), traceId, counts: { workers: queued.queued } });
    return NextResponse.json({ queued: true, traceId }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // The durable queue migration is installed in production. Never fall back
    // to an untracked fire-and-forget fan-out: it can be interrupted after the
    // UI says work has started and cannot provide retries or an audit trail.
    logOperation({ route: "/api/system/automation", operation: "queue_maintenance", outcome: "failed", durationMs: Date.now() - startedAt, requestId: request.headers.get("x-vercel-id"), traceId, error: "automation_queue_unavailable" });
    return NextResponse.json({ error: "Bakgrundsarbetet kunde inte köas. Försök igen; inget arbete har startats osynligt." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
