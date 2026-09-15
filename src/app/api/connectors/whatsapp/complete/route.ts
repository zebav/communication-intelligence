import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { encryptCredential } from "@/lib/connectors/credential-crypto";
import { whatsappConnector } from "@/lib/connectors/whatsapp";
import { whatsappPhoneUrl, whatsappSubscribedAppsUrl } from "@/lib/connectors/whatsapp-api";
import { whatsappTokenExchangeUrl } from "@/lib/connectors/whatsapp-embedded-signup";

const inputSchema = z.object({ code: z.string().min(8).max(4096), businessAccountId: z.string().regex(/^\d+$/), phoneNumberId: z.string().regex(/^\d+$/).optional() });
const jsonError = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function POST(request: NextRequest) {
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) return jsonError("Sign in before connecting WhatsApp.", 401);
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return jsonError("Complete MFA before connecting WhatsApp.", 403);
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Meta did not return a complete WhatsApp connection.");

  const appId = process.env.WHATSAPP_APP_ID?.trim() || process.env.INSTAGRAM_APP_ID?.trim();
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim() || process.env.INSTAGRAM_APP_SECRET?.trim();
  const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  const version = process.env.META_GRAPH_API_VERSION || "v26.0";
  if (!appId || !appSecret || !encryptionKey) return jsonError("WhatsApp coexistence is not fully configured.", 503);

  try {
    const tokenResponse = await fetch(whatsappTokenExchangeUrl({ appId, appSecret, code: parsed.data.code, version }), { signal: AbortSignal.timeout(15_000) });
    const tokenResult = await tokenResponse.json() as { access_token?: string };
    if (!tokenResponse.ok || !tokenResult.access_token) return jsonError("Meta could not authorize this WhatsApp Business account.", 409);

    // Coexistence completion can contain only the WABA ID. Resolve the number
    // from Meta using the exchanged token, never from stale local metadata.
    const numbersUrl = new URL(whatsappSubscribedAppsUrl(parsed.data.businessAccountId, version));
    numbersUrl.pathname = numbersUrl.pathname.replace(/subscribed_apps$/, "phone_numbers");
    numbersUrl.searchParams.set("fields", "id,is_on_biz_app,platform_type");
    const numbersResponse = await fetch(numbersUrl, { headers: { authorization: `Bearer ${tokenResult.access_token}` }, signal: AbortSignal.timeout(15_000) });
    const numbers = await numbersResponse.json() as { data?: Array<{ id: string; is_on_biz_app?: boolean; platform_type?: string }>; paging?: { next?: string } };
    const candidates = numbers.data?.filter((number) => parsed.data.phoneNumberId ? number.id === parsed.data.phoneNumberId : number.is_on_biz_app === true && number.platform_type === "CLOUD_API") ?? [];
    if (!numbersResponse.ok || candidates.length !== 1 || (!parsed.data.phoneNumberId && numbers.paging?.next)) return jsonError("Meta did not identify one connected WhatsApp Business app number. Complete the Business Platform connection in WhatsApp Business and try again.", 409);
    const selectedNumber = candidates[0];
    if (!/^\d+$/.test(selectedNumber.id) || selectedNumber.is_on_biz_app !== true || selectedNumber.platform_type !== "CLOUD_API") return jsonError("This number is not connected to both WhatsApp Business and Cloud API. Complete the Business Platform connection on your phone first.", 409);
    const phoneNumberId = selectedNumber.id;

    const profileResponse = await fetch(whatsappPhoneUrl(phoneNumberId, version), { headers: { authorization: `Bearer ${tokenResult.access_token}` }, signal: AbortSignal.timeout(15_000) });
    const profile = await profileResponse.json() as { display_phone_number?: string; verified_name?: string; quality_rating?: string };
    if (!profileResponse.ok) return jsonError("The selected WhatsApp number could not be verified.", 409);

    // Embedded Signup authorizes the account, but webhook delivery still requires
    // this app to be subscribed to the WhatsApp Business Account (WABA).
    const subscriptionResponse = await fetch(whatsappSubscribedAppsUrl(parsed.data.businessAccountId, version), {
      method: "POST",
      headers: { authorization: `Bearer ${tokenResult.access_token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const subscriptionResult = await subscriptionResponse.json().catch(() => null) as { success?: boolean; error?: { message?: string; code?: number } } | null;
    if (!subscriptionResponse.ok || subscriptionResult?.success !== true) {
      console.error("WhatsApp WABA webhook subscription failed", {
        businessAccountId: parsed.data.businessAccountId,
        phoneNumberId: phoneNumberId,
        status: subscriptionResponse.status,
        code: subscriptionResult?.error?.code,
        message: subscriptionResult?.error?.message,
      });
      return jsonError("WhatsApp was authorized, but live message delivery could not be activated. Reconnect after checking the Meta webhook configuration.", 409);
    }

    const accountIdentifier = profile.display_phone_number || phoneNumberId;
    const values = {
      owner_id: user.id,
      provider: whatsappConnector.id,
      source: "whatsapp",
      account_name: profile.verified_name || "WhatsApp Business",
      account_identifier: accountIdentifier,
      status: "connected",
      health_status: "healthy",
      capabilities: whatsappConnector.capabilities,
      scopes: [...whatsappConnector.scopes],
      encrypted_credentials: encryptCredential({ accessToken: tokenResult.access_token }, encryptionKey),
      token_metadata: {
        phone_number_id: phoneNumberId,
        business_account_id: parsed.data.businessAccountId,
        display_phone_number: accountIdentifier,
        quality_rating: profile.quality_rating ?? null,
        onboarding: "business_app_coexistence",
        webhook_subscription: "subscribed",
        webhook_subscribed_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    };
    const { data: existing } = await database.from("connections").select("id").eq("owner_id", user.id).eq("provider", whatsappConnector.id).contains("token_metadata", { phone_number_id: phoneNumberId }).maybeSingle();
    const saved = existing?.id ? await database.from("connections").update(values).eq("id", existing.id).eq("owner_id", user.id) : await database.from("connections").insert(values);
    if (saved.error) return jsonError("The WhatsApp connection could not be saved.", 500);

    await database.from("audit_logs").insert({
      owner_id: user.id,
      actor_id: user.id,
      actor_type: "user",
      action: "connection.created",
      object_type: "connection",
      source: "whatsapp",
      new_value: { provider: whatsappConnector.id, phone_number_id: phoneNumberId, business_account_id: parsed.data.businessAccountId, onboarding: "business_app_coexistence", webhook_subscription: "subscribed" },
    });
    return NextResponse.json({ connected: true, accountName: values.account_name, accountIdentifier, webhookSubscribed: true });
  } catch (caught) {
    console.error("WhatsApp coexistence connection failed", caught instanceof Error ? caught.message : "unknown");
    return jsonError("The WhatsApp connection could not be completed. Try again.", 500);
  }
}
