import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { encryptCredential } from "@/lib/connectors/credential-crypto";
import { whatsappConnector } from "@/lib/connectors/whatsapp";
import { whatsappPhoneUrl } from "@/lib/connectors/whatsapp-api";
import { whatsappTokenExchangeUrl } from "@/lib/connectors/whatsapp-embedded-signup";

const inputSchema = z.object({ code: z.string().min(8).max(4096), businessAccountId: z.string().regex(/^\d+$/), phoneNumberId: z.string().regex(/^\d+$/) });
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
    const profileResponse = await fetch(whatsappPhoneUrl(parsed.data.phoneNumberId, version), { headers: { authorization: `Bearer ${tokenResult.access_token}` }, signal: AbortSignal.timeout(15_000) });
    const profile = await profileResponse.json() as { display_phone_number?: string; verified_name?: string; quality_rating?: string };
    if (!profileResponse.ok) return jsonError("The selected WhatsApp number could not be verified.", 409);
    const accountIdentifier = profile.display_phone_number || parsed.data.phoneNumberId;
    const values = {
      owner_id: user.id, provider: whatsappConnector.id, source: "whatsapp", account_name: profile.verified_name || "WhatsApp Business",
      account_identifier: accountIdentifier, status: "connected", health_status: "healthy", capabilities: whatsappConnector.capabilities,
      scopes: [...whatsappConnector.scopes], encrypted_credentials: encryptCredential({ accessToken: tokenResult.access_token }, encryptionKey),
      token_metadata: { phone_number_id: parsed.data.phoneNumberId, business_account_id: parsed.data.businessAccountId, display_phone_number: accountIdentifier, quality_rating: profile.quality_rating ?? null, onboarding: "business_app_coexistence" },
      updated_at: new Date().toISOString(),
    };
    const { data: existing } = await database.from("connections").select("id").eq("owner_id", user.id).eq("provider", whatsappConnector.id).contains("token_metadata", { phone_number_id: parsed.data.phoneNumberId }).maybeSingle();
    const saved = existing?.id ? await database.from("connections").update(values).eq("id", existing.id).eq("owner_id", user.id) : await database.from("connections").insert(values);
    if (saved.error) return jsonError("The WhatsApp connection could not be saved.", 500);
    await database.from("audit_logs").insert({ owner_id: user.id, actor_id: user.id, actor_type: "user", action: "connection.created", object_type: "connection", source: "whatsapp", new_value: { provider: whatsappConnector.id, phone_number_id: parsed.data.phoneNumberId, onboarding: "business_app_coexistence" } });
    return NextResponse.json({ connected: true, accountName: values.account_name, accountIdentifier });
  } catch (caught) {
    console.error("WhatsApp coexistence connection failed", caught instanceof Error ? caught.message : "unknown");
    return jsonError("The WhatsApp connection could not be completed. Try again.", 500);
  }
}
