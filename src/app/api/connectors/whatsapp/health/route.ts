import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { whatsappConnector } from "@/lib/connectors/whatsapp";

export async function GET() {
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) return NextResponse.json({ error: "Your session has expired. Sign in again." }, { status: 401 });
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.json({ error: "Two-factor authentication is required." }, { status: 403 });
  const { data: connections, error } = await database.from("connections").select("id,account_name,account_identifier,status,health_status,last_sync_at,token_metadata").eq("owner_id", user.id).eq("provider", whatsappConnector.id).order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: "WhatsApp status could not be loaded." }, { status: 500 });
  return NextResponse.json({ configured: { credentials: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_BUSINESS_ACCOUNT_ID), webhook: Boolean(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN), signature: Boolean(process.env.WHATSAPP_APP_SECRET || process.env.INSTAGRAM_APP_SECRET), serverAccess: Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) }, accounts: connections ?? [] });
}
