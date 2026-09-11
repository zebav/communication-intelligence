import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { analyzeIncomingInstagramMessage } from "@/lib/connectors/instagram-intelligence";
import { instagramConnector } from "@/lib/connectors/instagram";

const schema = z.object({ connectionId: z.string().uuid() });
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: "Choose a valid Instagram account." }, { status: 400 });
  const database = await createClient(); const { data: { user } } = await database.auth.getUser(); if (!user) return NextResponse.json({ error: "Your session has expired. Sign in again." }, { status: 401 });
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel(); if (assurance?.currentLevel !== "aal2") return NextResponse.json({ error: "Two-factor authentication is required." }, { status: 403 });
  const { data: connection } = await database.from("connections").select("id").eq("id", parsed.data.connectionId).eq("owner_id", user.id).eq("provider", instagramConnector.id).maybeSingle(); if (!connection) return NextResponse.json({ error: "Instagram account not found." }, { status: 404 });
  const { data: conversations } = await database.from("conversations").select("id").eq("owner_id", user.id).eq("connection_id", connection.id).eq("source", "instagram"); const ids = (conversations ?? []).map((item) => item.id);
  const { data: pending } = ids.length ? await database.from("messages").select("id,conversation_id").eq("owner_id", user.id).eq("source", "instagram").eq("direction", "in").is("processed_at", null).in("conversation_id", ids).order("sent_at", { ascending: true }).limit(3) : { data: [] };
  const results = await Promise.allSettled((pending ?? []).map((message) => analyzeIncomingInstagramMessage({ ownerId: user.id, conversationId: message.conversation_id, messageId: message.id })));
  const analyzed = results.filter((result) => result.status === "fulfilled").length; const failed = results.length - analyzed;
  await database.from("connections").update({ health_status: failed ? "degraded" : "healthy", ...(analyzed ? { last_sync_at: new Date().toISOString() } : {}), updated_at: new Date().toISOString() }).eq("id", connection.id).eq("owner_id", user.id);
  return NextResponse.json({ analyzed, failed, remaining: Math.max(0, (pending?.length ?? 0) - analyzed) });
}
