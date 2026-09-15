import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptCredential } from "@/lib/connectors/credential-crypto";
import { whatsappConnector } from "@/lib/connectors/whatsapp";
import { whatsappSubscribedAppsUrl } from "@/lib/connectors/whatsapp-api";

import { whatsappCallbackUrl } from "@/lib/connectors/whatsapp-callback";

type StoredCredentials = { accessToken?: string };
type Subscription = { override_callback_uri?: string | null; whatsapp_business_api_data?: { id?: string; name?: string } };

export async function GET(request: NextRequest) {
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
  const expectedCallbackUrl = whatsappCallbackUrl(request.nextUrl.origin);

  const appId = process.env.WHATSAPP_APP_ID || process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.WHATSAPP_APP_SECRET || process.env.INSTAGRAM_APP_SECRET;
  let messagesField: "subscribed" | "not_subscribed" | "unknown" = "unknown";
  let appCallbackUrl: string | null = null;
  let appSubscriptionError: string | null = null;
  if (appId && appSecret) {
    try {
      const response = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(appId)}/subscriptions`, {
        headers: { authorization: `Bearer ${appId}|${appSecret}` },
        signal: AbortSignal.timeout(10_000), cache: "no-store",
      });
      const result = await response.json() as { data?: Array<{ object?: string; active?: boolean; callback_url?: string; fields?: Array<{ name?: string }> }> };
      if (response.ok && Array.isArray(result.data)) {
        const subscription = result.data.find((item) => item.object === "whatsapp_business_account");
        messagesField = subscription?.active && subscription.fields?.some((field) => field.name === "messages") ? "subscribed" : "not_subscribed";
        appCallbackUrl = subscription?.callback_url ?? null;
      } else appSubscriptionError = `Meta app subscription check returned ${response.status}`;
    } catch { appSubscriptionError = "Meta app subscription check failed."; }
  }

  const accounts = await Promise.all((connections ?? []).map(async (connection) => {
    const metadata = connection.token_metadata && typeof connection.token_metadata === "object" && !Array.isArray(connection.token_metadata) ? connection.token_metadata as Record<string, unknown> : {};
    const businessAccountId = String(metadata.business_account_id ?? "");
    let liveDelivery: "subscribed" | "not_subscribed" | "unknown" = "unknown";
    let liveDeliveryError: string | null = null;
    let callbackUrl: string | null = null;

    if (encryptionKey && connection.encrypted_credentials && /^\d+$/.test(businessAccountId)) {
      try {
        const credentials = decryptCredential<StoredCredentials>(connection.encrypted_credentials, encryptionKey);
        if (credentials.accessToken) {
          const response = await fetch(whatsappSubscribedAppsUrl(businessAccountId, version), {
            headers: { authorization: `Bearer ${credentials.accessToken}` },
            signal: AbortSignal.timeout(10_000),
          });
          const result = await response.json().catch(() => null) as { data?: Subscription[]; error?: { message?: string } } | null;
          if (response.ok && Array.isArray(result?.data) && appId) {
            const subscription = result.data.find((item) => item.whatsapp_business_api_data?.id === appId);
            liveDelivery = subscription ? "subscribed" : "not_subscribed";
            callbackUrl = subscription ? subscription.override_callback_uri || appCallbackUrl : null;
          } else liveDeliveryError = result?.error?.message || `Meta returned ${response.status}`;
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
      messages_field: messagesField,
      app_subscription_error: appSubscriptionError,
      callback_url: callbackUrl,
      expected_callback_url: expectedCallbackUrl,
      callback_matches: callbackUrl ? callbackUrl === expectedCallbackUrl : null,
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
    expectedCallbackUrl,
    accounts,
  });
}
