import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { decryptCredential } from "@/lib/connectors/credential-crypto";
import { whatsappConnector } from "@/lib/connectors/whatsapp";
import { whatsappSubscribedAppsUrl } from "@/lib/connectors/whatsapp-api";

const schema = z.object({ connectionId: z.string().uuid() });

type StoredCredentials = { accessToken?: string };

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid WhatsApp connection." }, { status: 400 });

  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) return NextResponse.json({ error: "Your session has expired. Sign in again." }, { status: 401 });
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.json({ error: "Two-factor authentication is required." }, { status: 403 });

  const { data: connection, error } = await database
    .from("connections")
    .select("id,encrypted_credentials,token_metadata")
    .eq("id", parsed.data.connectionId)
    .eq("owner_id", user.id)
    .eq("provider", whatsappConnector.id)
    .eq("status", "connected")
    .maybeSingle();
  if (error || !connection) return NextResponse.json({ error: "The WhatsApp connection could not be loaded." }, { status: 404 });

  const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!encryptionKey || !connection.encrypted_credentials) return NextResponse.json({ error: "The WhatsApp credentials are not available. Reconnect WhatsApp." }, { status: 409 });
  const metadata = connection.token_metadata && typeof connection.token_metadata === "object" && !Array.isArray(connection.token_metadata) ? connection.token_metadata as Record<string, unknown> : {};
  const businessAccountId = String(metadata.business_account_id ?? "");
  if (!/^\d+$/.test(businessAccountId)) return NextResponse.json({ error: "The WhatsApp Business Account ID is missing. Reconnect WhatsApp." }, { status: 409 });

  try {
    const credentials = decryptCredential<StoredCredentials>(connection.encrypted_credentials, encryptionKey);
    if (!credentials.accessToken) return NextResponse.json({ error: "The WhatsApp token is missing. Reconnect WhatsApp." }, { status: 409 });
    const version = process.env.META_GRAPH_API_VERSION || "v26.0";
    const response = await fetch(whatsappSubscribedAppsUrl(businessAccountId, version), {
      method: "POST",
      headers: { authorization: `Bearer ${credentials.accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json().catch(() => null) as { success?: boolean; error?: { message?: string; code?: number } } | null;
    if (!response.ok || result?.success !== true) {
      console.error("WhatsApp webhook repair failed", { connectionId: connection.id, status: response.status, code: result?.error?.code, message: result?.error?.message });
      return NextResponse.json({ error: result?.error?.message || "Meta did not activate live WhatsApp delivery." }, { status: 409 });
    }

    const now = new Date().toISOString();
    await database.from("connections").update({ token_metadata: { ...metadata, webhook_subscription: "subscribed", webhook_subscribed_at: now }, health_status: "healthy", updated_at: now }).eq("id", connection.id).eq("owner_id", user.id);
    await database.from("audit_logs").insert({ owner_id: user.id, actor_id: user.id, actor_type: "user", action: "connection.webhook_subscribed", object_type: "connection", object_id: connection.id, source: "whatsapp", new_value: { business_account_id: businessAccountId, subscribed_at: now } });
    return NextResponse.json({ success: true, subscribed: true });
  } catch (caught) {
    console.error("WhatsApp webhook repair failed", caught instanceof Error ? caught.message : "unknown");
    return NextResponse.json({ error: "WhatsApp live delivery could not be activated. Reconnect the account if the token has expired." }, { status: 500 });
  }
}
