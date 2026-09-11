import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { analyzeIncomingInstagramMessage } from "@/lib/connectors/instagram-intelligence";
import { instagramConnector } from "@/lib/connectors/instagram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function metadataObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const database = createAdminClient();
  const { data: pending, error } = await database.from("messages").select("id,owner_id,conversation_id,metadata").eq("source", "instagram").eq("direction", "in").is("processed_at", null).order("sent_at", { ascending: true }).limit(10);
  if (error) return NextResponse.json({ error: "Pending Instagram messages could not be loaded." }, { status: 500 });
  const candidates = (pending ?? []).filter((message) => !metadataObject(message.metadata).ai_analysis).slice(0, 3);
  const results = await Promise.allSettled(candidates.map((message) => analyzeIncomingInstagramMessage({ ownerId: message.owner_id, conversationId: message.conversation_id, messageId: message.id })));
  const analyzed = results.filter((result) => result.status === "fulfilled").length;
  const failed = results.length - analyzed;
  if (failed) await database.from("connections").update({ health_status: "degraded", updated_at: new Date().toISOString() }).eq("provider", instagramConnector.id).eq("status", "connected");
  else if (analyzed) await database.from("connections").update({ health_status: "healthy", last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("provider", instagramConnector.id).eq("status", "connected");
  return NextResponse.json({ ok: true, analyzed, failed, remaining: Math.max(0, (pending?.length ?? 0) - candidates.length), analysisLimit: 3 });
}
