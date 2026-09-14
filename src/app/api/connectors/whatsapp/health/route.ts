import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptCredential } from "@/lib/connectors/credential-crypto";
import { whatsappConnector } from "@/lib/connectors/whatsapp";
import { whatsappSubscribedAppsUrl } from "@/lib/connectors/whatsapp-api";

type StoredCredentials = { accessToken?: string };

export async function GET() {
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) return NextResponse.json({ error: "Your session has expired. Sign in again." }, { status: 401 });
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.json({ error: "Two-factor authentication is required." }, { status: 403 });

  const { data: connections, error } = await database
    .from("connections")
    .select("id,account_name,account_identifier,status,health_status,last_sync_at,token_metadata,encrypted_credentials")
    .eq("owner_id", user.id)
    .eq("provider", whatsappConnector.id)
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: "WhatsApp status could not be loaded." }, { status: 500 });

  const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  const version = process.env.META_GRAPH_API_VERSION || "v26.0";
  const accounts = await Promise.all((connections ?? []).map(async (connection) => {
    const metadata = connection.token_metadata && typeof connection.token_metadata === "object" && !Array.isArray(connection.token_metadata) ? connection.token_metadata as Record<string, unknown> : {};
    const businessAccountId = String(metadata.business_account_id ?? "");
    let liveDelivery: "subscribed" | "not_subscribed" | "unknown" = metadata.webhook_subscription === "subscribed" ? "subscribed" : "unknown";
    let liveDeliveryError: string | null = null;

    if (encryptionKey && connection.encrypted_credentials && /^\d+$/.test(businessAccountId)) {
      try {
        const credentials = decryptCredential<StoredCredentials>(connection.encrypted_credentials, encryptionKey);
        if (credentials.accessToken) {
          const response = await fetch(whatsappSubscribedAppsUrl(businessAccountId, version), {
            headers: { authorization: `Bearer ${credentials.accessToken}` },
            signal: AbortSignal.timeout(10_000),
          });
          const result = await response.json().catch(() => null) as { data?: unknown[]; error?: { message?: string } } | null;
          if (response.ok) liveDelivery = Array.isArray(result?.data) && result.data.length > 0 ? "subscribed" : "not_subscribed";
          else liveDeliveryError = result?.error?.message || `Meta returned ${response.status}`;
        }
      } catch (caught) {
        liveDeliveryError = caught instanceof Error ? caught.message : "Unable to verify live delivery.";
      }
    }

    return {
      id: connection.id,
      account_name: connection.account_name,
      account_identifier: connection.account_identifier,
      status: connection.status,
      health_status: connection.health_status,
      last_sync_at: connection.last_sync_at,
      token_metadata: metadata,
      live_delivery: liveDelivery,
      live_delivery_error: liveDeliveryError,
    };
  }));

  return NextResponse.json({
    configured: {
      embeddedSignup: Boolean(process.env.WHATSAPP_APP_ID || process.env.INSTAGRAM_APP_ID),
      webhook: Boolean(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN),
      signature: Boolean(process.env.WHATSAPP_APP_SECRET || process.env.INSTAGRAM_APP_SECRET),
      serverAccess: Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
      encryption: Boolean(process.env.CREDENTIAL_ENCRYPTION_KEY),
    },
    accounts,
  });
}
