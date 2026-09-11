import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in before connecting WhatsApp." }, { status: 401 });
  const appId = process.env.WHATSAPP_APP_ID?.trim() || process.env.INSTAGRAM_APP_ID?.trim();
  const configId = process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID?.trim();
  if (!appId || !configId) return NextResponse.json({ error: "WhatsApp coexistence needs to be configured in Meta first." }, { status: 503 });
  return NextResponse.json({ appId, configId, version: process.env.META_GRAPH_API_VERSION || "v26.0" });
}
