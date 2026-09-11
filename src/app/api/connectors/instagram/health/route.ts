import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { instagramConnector } from "@/lib/connectors/instagram";

export async function GET() {
  const database = await createClient(); const { data: { user } } = await database.auth.getUser();
  if (!user) return NextResponse.json({ error: "Your session has expired. Sign in again." }, { status: 401 });
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.json({ error: "Two-factor authentication is required." }, { status: 403 });
  const { data: connections, error } = await database.from("connections").select("id,account_name,account_identifier,status,health_status,last_sync_at,token_metadata").eq("owner_id", user.id).eq("provider", instagramConnector.id).order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Instagram status could not be loaded." }, { status: 500 });
  const accounts = await Promise.all((connections ?? []).map(async (connection) => {
    const metadata = connection.token_metadata && typeof connection.token_metadata === "object" && !Array.isArray(connection.token_metadata) ? connection.token_metadata as Record<string, unknown> : {};
    const { data: conversations } = await database.from("conversations").select("id,last_message_at").eq("owner_id", user.id).eq("connection_id", connection.id).eq("source", "instagram");
    const conversationIds = (conversations ?? []).map((item) => item.id);
    const { data: messages } = conversationIds.length ? await database.from("messages").select("sent_at,processed_at,direction").eq("owner_id", user.id).eq("source", "instagram").in("conversation_id", conversationIds).order("sent_at", { ascending: false }).limit(500) : { data: [] };
    const incoming = (messages ?? []).filter((item) => item.direction === "in");
    const expiresAt = typeof metadata.expires_at === "string" ? metadata.expires_at : null;
    const expired = expiresAt ? new Date(expiresAt).getTime() <= Date.now() : false;
    const pending = incoming.filter((item) => !item.processed_at).length;
    return { id: connection.id, label: connection.account_identifier ?? connection.account_name ?? "Instagram account", status: expired ? "reconnect_required" : connection.status, health: expired ? "expired_token" : pending > 0 || connection.health_status === "degraded" ? "attention_required" : connection.health_status, lastMessageAt: incoming[0]?.sent_at ?? null, lastAnalysisAt: incoming.find((item) => item.processed_at)?.processed_at ?? null, pending, expiresAt };
  }));
  return NextResponse.json({ configured: { oauth: Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET && process.env.INSTAGRAM_REDIRECT_URI), webhook: Boolean(process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN), serverAccess: Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) }, accounts });
}
