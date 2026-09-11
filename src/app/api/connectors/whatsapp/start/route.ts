import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptCredential } from "@/lib/connectors/credential-crypto";
import { whatsappConnector } from "@/lib/connectors/whatsapp";
import { whatsappPhoneUrl } from "@/lib/connectors/whatsapp-api";

const redirect = (request: NextRequest, result: string) => NextResponse.redirect(new URL(`/?whatsapp=${result}`, request.url));

export async function GET(request: NextRequest) {
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.redirect(new URL("/auth/mfa", request.url));
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim();
  const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!accessToken || !phoneNumberId || !businessAccountId || !encryptionKey) return redirect(request, "configuration_required");
  try {
    const response = await fetch(whatsappPhoneUrl(phoneNumberId), { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return redirect(request, "permission_failed");
    const profile = await response.json() as { display_phone_number?: string; verified_name?: string; quality_rating?: string };
    const accountIdentifier = profile.display_phone_number ?? process.env.WHATSAPP_DISPLAY_PHONE_NUMBER?.trim() ?? phoneNumberId;
    const encryptedCredentials = encryptCredential({ accessToken }, encryptionKey);
    const values = { owner_id: user.id, provider: whatsappConnector.id, source: "whatsapp", account_name: profile.verified_name ?? "WhatsApp Business", account_identifier: accountIdentifier, status: "connected", health_status: "healthy", capabilities: whatsappConnector.capabilities, scopes: [...whatsappConnector.scopes], encrypted_credentials: encryptedCredentials, token_metadata: { phone_number_id: phoneNumberId, business_account_id: businessAccountId, display_phone_number: accountIdentifier, quality_rating: profile.quality_rating ?? null }, updated_at: new Date().toISOString() };
    const { data: existing } = await database.from("connections").select("id").eq("owner_id", user.id).eq("provider", whatsappConnector.id).contains("token_metadata", { phone_number_id: phoneNumberId }).maybeSingle();
    const result = existing?.id ? await database.from("connections").update(values).eq("id", existing.id).eq("owner_id", user.id) : await database.from("connections").insert(values);
    return redirect(request, result.error ? "failed" : "connected");
  } catch (error) {
    console.error("WhatsApp connection failed", error instanceof Error ? error.message : "unknown");
    return redirect(request, "failed");
  }
}
