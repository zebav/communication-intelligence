import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileSlackConnection } from "@/lib/connectors/slack-reconciliation";
import { analyzeIncomingInstagramMessage } from "@/lib/connectors/instagram-intelligence";
import { logOperation } from "@/lib/observability";
import { ownerIdFromCronHeaders } from "@/lib/cron-owner";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  if (!isAuthorizedCron(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const ownerId = ownerIdFromCronHeaders(request.headers);
  // Keep Slack accounts independent and bounded, exactly like the other
  // source workers. The account with the oldest successful import is next.
  let connectionQuery = db.from("connections").select("id").eq("provider", "slack").eq("status", "connected").order("last_sync_at", { ascending: true, nullsFirst: true });
  if (ownerId) connectionQuery = connectionQuery.eq("owner_id", ownerId);
  const { data: connections } = await connectionQuery.limit(1);
  const results = await Promise.allSettled((connections ?? []).map(({ id }) => reconcileSlackConnection(id)));
  const failureCodes = results.filter((result): result is PromiseRejectedResult => result.status === "rejected").map((result) => result.reason instanceof Error ? result.reason.message : "slack_unknown_failure");
  const reconnectRequired = failureCodes.some((code) => /slack_(reconnect_required|invalid_auth|token_revoked|missing_scope|not_authed)/.test(code));
  // Reconciliation can finish while a prior AI analysis was interrupted. Pick
  // up that durable backlog on every pass so Slack has the same automatic
  // recovery guarantee as email, Instagram, and WhatsApp.
  let pendingQuery = db.from("messages")
    .select("id,owner_id,conversation_id")
    .eq("source", "slack")
    .eq("direction", "in")
    .is("processed_at", null)
    .order("sent_at", { ascending: true });
  if (ownerId) pendingQuery = pendingQuery.eq("owner_id", ownerId);
  const { data: pending, error: pendingError } = await pendingQuery.limit(12);
  const analysisCandidates = pendingError ? [] : (pending ?? []).slice(0, 3);
  const analysisResults = await Promise.allSettled(analysisCandidates.map((message) => analyzeIncomingInstagramMessage({
    ownerId: message.owner_id,
    conversationId: message.conversation_id,
    messageId: message.id,
    source: "slack",
  })));
  const analysisFailed = pendingError ? 1 : analysisResults.filter((result) => result.status === "rejected").length;
  const analyzed = analysisResults.filter((result) => result.status === "fulfilled" && result.value.status === "analyzed").length;
  const blockedMedia = analysisResults.filter((result) => result.status === "fulfilled" && result.value.status === "blocked_media").length;
  const failed = results.filter((result) => result.status === "rejected").length + analysisFailed;
  if (failed && connections?.length) await db.from("connections").update({ health_status: reconnectRequired ? "reconnect_required" : "degraded", updated_at: new Date().toISOString() }).in("id", connections.map(({ id }) => id));
  const imported = results.filter((result): result is PromiseFulfilledResult<{ imported: number }> => result.status === "fulfilled").reduce((sum, result) => sum + result.value.imported, 0);
  logOperation({ route: "/api/cron/slack-intelligence", operation: "slack_import_and_analysis", outcome: failed ? "failed" : "completed", durationMs: Date.now() - startedAt, requestId: request.headers.get("x-vercel-id"), traceId: request.headers.get("x-solvani-trace-id"), counts: { connections: connections?.length ?? 0, imported, analyzed, blocked_media: blockedMedia, pending: pending?.length ?? 0, remaining: Math.max(0, (pending?.length ?? 0) - analysisCandidates.length), failed }, error: failureCodes[0] ?? (pendingError ? "slack_pending_messages_unavailable" : undefined) });
  return NextResponse.json({ ok: true, imported, analyzed, blockedMedia, failed, reconnectRequired, remaining: Math.max(0, (pending?.length ?? 0) - analysisCandidates.length), analysisLimit: 3 });
}
