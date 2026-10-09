import { after, NextRequest, NextResponse } from "next/server";
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
    // This compatibility path keeps imports available during the additive
    // migration rollout. It is intentionally temporary: once every deployed
    // database has automation_jobs, the durable dispatcher is authoritative.
    after(async () => {
      const headers = {
        authorization: `Bearer ${cronSecret}`,
        "x-owner-id": ownerId,
        "x-maintenance-trigger": "login",
        "x-solvani-trace-id": traceId,
      };
      // Start only bounded workers after the workspace has rendered. Each
      // worker is independently protected by its cron authorization, and a
      // temporary provider problem must never delay or break login.
      await Promise.allSettled([
        "/api/cron/outlook-intelligence",
        "/api/cron/gmail-intelligence",
        "/api/cron/instagram-intelligence",
        "/api/cron/whatsapp-intelligence",
        "/api/cron/slack-intelligence",
        "/api/cron/calendar-sync",
        "/api/cron/vault-ingestion",
        "/api/cron/relationship-backfill",
      ].map((path) => fetch(new URL(path, request.url), {
        headers,
        signal: AbortSignal.timeout(55_000),
      })));
    });
    logOperation({ route: "/api/system/automation", operation: "start_maintenance_legacy_fallback", outcome: "queued", durationMs: Date.now() - startedAt, requestId: request.headers.get("x-vercel-id"), traceId, counts: { workers: 8 }, error: "automation_queue_unavailable" });
    return NextResponse.json({ queued: true, traceId, durable: false }, { headers: { "Cache-Control": "no-store" } });
  }
}
