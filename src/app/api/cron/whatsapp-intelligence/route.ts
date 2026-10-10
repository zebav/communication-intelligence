import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { analyzeIncomingWhatsAppMessage } from "@/lib/connectors/whatsapp-intelligence";
import { whatsappConnector } from "@/lib/connectors/whatsapp";
import { ownerIdFromCronHeaders } from "@/lib/cron-owner";
import { logOperation } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function metadataObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * WhatsApp is delivered immediately by its webhook. This bounded worker is a
 * recovery path for an imported message whose intelligence step was interrupted.
 * It never polls private chats and it never sends a message.
 */
export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  if (!isAuthorizedCron(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const database = createAdminClient();
  const ownerId = ownerIdFromCronHeaders(request.headers);
  let pendingQuery = database.from("messages")
    .select("id,owner_id,conversation_id,metadata")
    .eq("source", "whatsapp").eq("direction", "in").is("processed_at", null)
    .order("sent_at", { ascending: true });
  if (ownerId) pendingQuery = pendingQuery.eq("owner_id", ownerId);
  const { data: pending, error } = await pendingQuery.limit(12);
  if (error) {
    logOperation({ route: "/api/cron/whatsapp-intelligence", operation: "whatsapp_analysis_recovery", outcome: "failed", durationMs: Date.now() - startedAt, requestId: request.headers.get("x-vercel-id"), traceId: request.headers.get("x-solvani-trace-id"), error: "pending_messages_unavailable" });
    return NextResponse.json({ error: "Pending WhatsApp messages could not be loaded." }, { status: 500 });
  }

  const candidates = (pending ?? []).filter((message) => !metadataObject(message.metadata).ai_analysis).slice(0, 3);
  const results = await Promise.allSettled(candidates.map((message) => analyzeIncomingWhatsAppMessage({
    ownerId: message.owner_id, conversationId: message.conversation_id, messageId: message.id,
  })));
  const analyzed = results.filter((result) => result.status === "fulfilled" && result.value.status === "analyzed").length;
  const blockedMedia = results.filter((result) => result.status === "fulfilled" && result.value.status === "blocked_media").length;
  const failed = results.filter((result) => result.status === "rejected").length;
  // Analysis is a recovery worker, not evidence that the live webhook is
  // disconnected. A transient AI/media error must not present WhatsApp as
  // requiring reconnection in the UI.
  if (!failed) {
    // A completed recovery pass is sufficient to clear an old analysis/media
    // incident from the *connection* state. WhatsApp is event-driven, so we
    // intentionally leave `last_sync_at` unchanged when no new message was
    // handled; the UI continues to say “Direktuppdatering aktiv” rather than
    // implying a mailbox poll happened.
    let connectionUpdate = database.from("connections").update({ health_status: "healthy", updated_at: new Date().toISOString() }).eq("provider", whatsappConnector.id).eq("status", "connected").neq("health_status", "reconnect_required");
    if (ownerId) connectionUpdate = connectionUpdate.eq("owner_id", ownerId);
    await connectionUpdate;
  }
  logOperation({ route: "/api/cron/whatsapp-intelligence", operation: "whatsapp_analysis_recovery", outcome: failed ? "failed" : "completed", durationMs: Date.now() - startedAt, requestId: request.headers.get("x-vercel-id"), traceId: request.headers.get("x-solvani-trace-id"), counts: { pending: pending?.length ?? 0, analyzed, blocked_media: blockedMedia, failed, remaining: Math.max(0, (pending?.length ?? 0) - candidates.length) }, error: failed ? "whatsapp_analysis_failed" : undefined });
  return NextResponse.json(
    { ok: !failed, analyzed, blockedMedia, failed, remaining: Math.max(0, (pending?.length ?? 0) - candidates.length), analysisLimit: 3 },
    { status: failed ? 502 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
