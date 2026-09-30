import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { dispatchScheduledMessage } from "@/lib/scheduled-messages";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const terminalReview = new Set(["account_changed", "recipient_changed", "original_message_missing", "reconnect_required", "WhatsApp-svar kräver ett inkommande"]);

export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = createAdminClient(); const now = new Date().toISOString();
  const { data: due, error } = await db.from("scheduled_messages").select("id,owner_id,conversation_id,source_message_id,source,body_text,expected_connection_id,expected_recipient").eq("status", "scheduled").lte("scheduled_for", now).order("scheduled_for").limit(8);
  if (error) return NextResponse.json({ error: "Scheduled messages could not be read." }, { status: 500 });
  const results = [];
  for (const item of due ?? []) {
    const claim = crypto.randomUUID();
    const { data: claimed } = await db.from("scheduled_messages").update({ status: "processing", claim_token: claim, claimed_at: now, updated_at: now }).eq("id", item.id).eq("status", "scheduled").select("id").maybeSingle();
    if (!claimed) continue;
    try {
      const sent = await dispatchScheduledMessage(db, item as never, request.nextUrl.origin);
      await db.from("scheduled_messages").update({ status: "sent", sent_at: sent.sentAt, sent_message_id: sent.sentMessageId, updated_at: sent.sentAt, claim_token: null }).eq("id", item.id).eq("claim_token", claim);
      results.push({ id: item.id, status: "sent" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "send_failed";
      const status = [...terminalReview].some((reason) => message.includes(reason)) ? "needs_review" : "failed";
      await db.from("scheduled_messages").update({ status, last_error: message.slice(0, 500), updated_at: new Date().toISOString(), claim_token: null }).eq("id", item.id).eq("claim_token", claim);
      results.push({ id: item.id, status });
    }
  }
  return NextResponse.json({ checked: due?.length ?? 0, results });
}
