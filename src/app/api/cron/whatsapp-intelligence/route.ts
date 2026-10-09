import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { analyzeIncomingWhatsAppMessage } from "@/lib/connectors/whatsapp-intelligence";
import { whatsappConnector } from "@/lib/connectors/whatsapp";
import { ownerIdFromCronHeaders } from "@/lib/cron-owner";

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
  if (!isAuthorizedCron(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const database = createAdminClient();
  const ownerId = ownerIdFromCronHeaders(request.headers);
  let pendingQuery = database.from("messages")
    .select("id,owner_id,conversation_id,metadata")
    .eq("source", "whatsapp").eq("direction", "in").is("processed_at", null)
    .order("sent_at", { ascending: true });
  if (ownerId) pendingQuery = pendingQuery.eq("owner_id", ownerId);
  const { data: pending, error } = await pendingQuery.limit(12);
  if (error) return NextResponse.json({ error: "Pending WhatsApp messages could not be loaded." }, { status: 500 });

  const candidates = (pending ?? []).filter((message) => !metadataObject(message.metadata).ai_analysis).slice(0, 3);
  const results = await Promise.allSettled(candidates.map((message) => analyzeIncomingWhatsAppMessage({
    ownerId: message.owner_id, conversationId: message.conversation_id, messageId: message.id,
  })));
  const analyzed = results.filter((result) => result.status === "fulfilled").length;
  const failed = results.length - analyzed;
  // Analysis is a recovery worker, not evidence that the live webhook is
  // disconnected. A transient AI/media error must not present WhatsApp as
  // requiring reconnection in the UI.
  if (analyzed) {
    let connectionUpdate = database.from("connections").update({ health_status: "healthy", last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("provider", whatsappConnector.id).eq("status", "connected");
    if (ownerId) connectionUpdate = connectionUpdate.eq("owner_id", ownerId);
    await connectionUpdate;
  }
  return NextResponse.json({ ok: true, analyzed, failed, remaining: Math.max(0, (pending?.length ?? 0) - candidates.length), analysisLimit: 3 });
}
