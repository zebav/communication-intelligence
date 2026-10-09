import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileSlackConnection } from "@/lib/connectors/slack-reconciliation";
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
  const failed = results.filter((result) => result.status === "rejected").length;
  const failureCodes = results.filter((result): result is PromiseRejectedResult => result.status === "rejected").map((result) => result.reason instanceof Error ? result.reason.message : "slack_unknown_failure");
  const reconnectRequired = failureCodes.some((code) => /slack_(reconnect_required|invalid_auth|token_revoked|missing_scope|not_authed)/.test(code));
  if (failed && connections?.length) await db.from("connections").update({ health_status: reconnectRequired ? "reconnect_required" : "degraded", updated_at: new Date().toISOString() }).in("id", connections.map(({ id }) => id));
  const imported = results.filter((result): result is PromiseFulfilledResult<{ imported: number }> => result.status === "fulfilled").reduce((sum, result) => sum + result.value.imported, 0);
  logOperation({ route: "/api/cron/slack-intelligence", operation: "slack_import", outcome: failed ? "failed" : "completed", durationMs: Date.now() - startedAt, requestId: request.headers.get("x-vercel-id"), traceId: request.headers.get("x-solvani-trace-id"), counts: { connections: connections?.length ?? 0, imported, failed }, error: failureCodes[0] });
  return NextResponse.json({ ok: true, imported, failed, reconnectRequired });
}
