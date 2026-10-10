import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileSlackConnection } from "@/lib/connectors/slack-reconciliation";
import { analyzeIncomingInstagramMessage } from "@/lib/connectors/instagram-intelligence";
import { logOperation } from "@/lib/observability";
import { ownerIdFromCronHeaders } from "@/lib/cron-owner";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const maxConnectionsPerPass = 2;
const maxAnalysisPerPass = 5;
export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  if (!isAuthorizedCron(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const ownerId = ownerIdFromCronHeaders(request.headers);
  // Keep Slack accounts independent and bounded, exactly like the other
  // source workers. A small batch gives each connected workspace timely turns.
  let connectionQuery = db.from("connections").select("id").eq("provider", "slack").eq("status", "connected").order("last_sync_at", { ascending: true, nullsFirst: true });
  if (ownerId) connectionQuery = connectionQuery.eq("owner_id", ownerId);
  const { data: connections } = await connectionQuery.limit(maxConnectionsPerPass);
  // The cron owns the durable analysis queue below. Reconciliation therefore
  // imports only here, preventing a duplicate analysis race with fresh items.
  const results = await Promise.allSettled((connections ?? []).map(({ id }) => reconcileSlackConnection(id, { analyze: false })));
  const failureCodes = results.filter((result): result is PromiseRejectedResult => result.status === "rejected").map((result) => result.reason instanceof Error ? result.reason.message : "slack_unknown_failure");
  const reconnectRequired = failureCodes.some((code) => /slack_(reconnect_required|invalid_auth|token_revoked|missing_scope|not_authed)/.test(code));
  // Reconciliation can finish while a prior AI analysis was interrupted. Pick
  // up that durable backlog on every pass so Slack has the same automatic
  // recovery guarantee as email, Instagram, and WhatsApp. New messages go
  // first: an old import must never hide a fresh direct message or mention.
  let pendingQuery = db.from("messages")
    .select("id,owner_id,conversation_id")
    .eq("source", "slack")
    .eq("direction", "in")
    .is("processed_at", null)
    .order("sent_at", { ascending: false });
  let pendingCountQuery = db.from("messages")
    .select("id", { count: "exact", head: true })
    .eq("source", "slack")
    .eq("direction", "in")
    .is("processed_at", null);
  if (ownerId) {
    pendingQuery = pendingQuery.eq("owner_id", ownerId);
    pendingCountQuery = pendingCountQuery.eq("owner_id", ownerId);
  }
  const [{ data: pending, error: pendingError }, pendingCountResult] = await Promise.all([pendingQuery.limit(12), pendingCountQuery]);
  const pendingTotal = pendingCountResult.error ? pending?.length ?? 0 : pendingCountResult.count ?? 0;
  const analysisCandidates = pendingError ? [] : (pending ?? []).slice(0, maxAnalysisPerPass);
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
  const fulfilled = results.filter((result): result is PromiseFulfilledResult<{ imported: number; readableConversations: number; unavailableConversations: number }> => result.status === "fulfilled");
  const imported = fulfilled.reduce((sum, result) => sum + result.value.imported, 0);
  const unavailableConversations = fulfilled.reduce((sum, result) => sum + result.value.unavailableConversations, 0);
  logOperation({ route: "/api/cron/slack-intelligence", operation: "slack_import_and_analysis", outcome: failed ? "failed" : "completed", durationMs: Date.now() - startedAt, requestId: request.headers.get("x-vercel-id"), traceId: request.headers.get("x-solvani-trace-id"), counts: { connections: connections?.length ?? 0, imported, unavailable_conversations: unavailableConversations, analyzed, blocked_media: blockedMedia, pending: pendingTotal, remaining: Math.max(0, pendingTotal - analysisCandidates.length), failed }, error: failureCodes[0] ?? (pendingError ? "slack_pending_messages_unavailable" : undefined) });
  // A non-success status is intentional: the durable dispatcher records it as
  // a retry, rather than presenting a failed Slack import as completed.
  return NextResponse.json(
    { ok: !failed, imported, unavailableConversations, analyzed, blockedMedia, failed, reconnectRequired, pending: pendingTotal, remaining: Math.max(0, pendingTotal - analysisCandidates.length), analysisLimit: maxAnalysisPerPass },
    { status: failed ? 502 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
