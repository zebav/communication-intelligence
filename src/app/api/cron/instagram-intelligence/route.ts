import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { analyzeIncomingInstagramMessage } from "@/lib/connectors/instagram-intelligence";
import { instagramConnector } from "@/lib/connectors/instagram";
import { reconcileInstagramConnection } from "@/lib/connectors/instagram-reconciliation";
import { readDataIngestionHealth } from "@/lib/data-ingestion-health";
import { logOperation } from "@/lib/observability";
import { ownerIdFromCronHeaders } from "@/lib/cron-owner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const maxConnectionsPerPass = 2;

function metadataObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  if (!isAuthorizedCron(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const database = createAdminClient();
  const ownerId = ownerIdFromCronHeaders(request.headers);
  // Service a small, least-recently-synced batch. Provider calls stay bounded
  // while a second connected account no longer has to wait for a later cron.
  let connectionQuery = database.from("connections").select("id").eq("provider", instagramConnector.id).eq("status", "connected").order("last_sync_at", { ascending: true, nullsFirst: true });
  if (ownerId) connectionQuery = connectionQuery.eq("owner_id", ownerId);
  const { data: connections } = await connectionQuery.limit(maxConnectionsPerPass);
  const reconciliation = await Promise.allSettled((connections ?? []).map((connection) => reconcileInstagramConnection(connection.id)));
  const reconciliationFailed = reconciliation.filter((result) => result.status === "rejected").length;
  const profileLookups = reconciliation.reduce((total, result) => total + (result.status === "fulfilled" ? result.value.profileLookups : 0), 0);
  const profilesResolved = reconciliation.reduce((total, result) => total + (result.status === "fulfilled" ? result.value.profilesResolved : 0), 0);
  const reconnectRequired = reconciliation.some((result) => result.status === "rejected" && /instagram_reconciliation_(401|403)$/.test(result.reason instanceof Error ? result.reason.message : ""));
  let pendingQuery = database.from("messages").select("id,owner_id,conversation_id,metadata").eq("source", "instagram").eq("direction", "in").is("processed_at", null).order("sent_at", { ascending: true });
  if (ownerId) pendingQuery = pendingQuery.eq("owner_id", ownerId);
  const { data: pending, error } = await pendingQuery.limit(10);
  if (error) return NextResponse.json({ error: "Pending Instagram messages could not be loaded." }, { status: 500 });
  const candidates = (pending ?? []).filter((message) => !metadataObject(message.metadata).ai_analysis).slice(0, 3);
  const results = await Promise.allSettled(candidates.map((message) => analyzeIncomingInstagramMessage({ ownerId: message.owner_id, conversationId: message.conversation_id, messageId: message.id })));
  const analyzed = results.filter((result) => result.status === "fulfilled" && result.value.status === "analyzed").length;
  const blockedMedia = results.filter((result) => result.status === "fulfilled" && result.value.status === "blocked_media").length;
  const failed = results.filter((result) => result.status === "rejected").length;
  if ((failed || reconciliationFailed) && connections?.length) await database.from("connections").update({ health_status: reconnectRequired ? "reconnect_required" : "degraded", updated_at: new Date().toISOString() }).in("id", connections.map(({ id }) => id));
  else if (analyzed && connections?.length) await database.from("connections").update({ health_status: "healthy", last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }).in("id", connections.map(({ id }) => id));
  const health = await readDataIngestionHealth(database).catch(() => null);
  if (health?.affectedConnectionIds.length) await database.from("connections").update({ health_status: "degraded", updated_at: new Date().toISOString() }).in("id", health.affectedConnectionIds);
  const outcome = failed || reconciliationFailed ? "failed" : "completed";
  logOperation({ route: "/api/cron/instagram-intelligence", operation: "instagram_import_and_analysis", outcome, durationMs: Date.now() - startedAt, requestId: request.headers.get("x-vercel-id"), traceId: request.headers.get("x-solvani-trace-id"), counts: { connections: connections?.length ?? 0, reconciled: reconciliation.length - reconciliationFailed, reconciliationFailed, profile_lookups: profileLookups, profiles_resolved: profilesResolved, analyzed, blocked_media: blockedMedia, failed, remaining: Math.max(0, (pending?.length ?? 0) - candidates.length) } });
  // The dispatcher must see a real failure status so that an interrupted
  // import is retried and remains visible in Operations instead of becoming a
  // misleading successful run.
  return NextResponse.json(
    { ok: outcome === "completed", analyzed, blockedMedia, failed, reconciled: reconciliation.length - reconciliationFailed, reconciliationFailed, profileLookups, profilesResolved, reconnectRequired, remaining: Math.max(0, (pending?.length ?? 0) - candidates.length), analysisLimit: 3, health },
    { status: outcome === "completed" ? 200 : 502, headers: { "Cache-Control": "no-store" } },
  );
}
