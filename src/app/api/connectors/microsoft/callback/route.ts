import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { encryptCredential } from "@/lib/connectors/credential-crypto";
import { microsoftGraphConnector } from "@/lib/connectors/microsoft-graph";
import { microsoftConfig } from "@/lib/connectors/microsoft-oauth";
import { createClient } from "@/lib/supabase/server";

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope?: string; token_type: string };
type MicrosoftProfile = { id: string; displayName?: string; mail?: string; userPrincipalName?: string };

function sameState(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function resultRedirect(request: NextRequest, result: "connected" | "denied" | "invalid" | "failed") {
  return NextResponse.redirect(new URL(`/?microsoft=${result}`, request.url));
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("error")) return resultRedirect(request, "denied");
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("microsoft_oauth_state")?.value;
  const verifier = cookieStore.get("microsoft_oauth_verifier")?.value;
  cookieStore.delete("microsoft_oauth_state");
  cookieStore.delete("microsoft_oauth_verifier");
  if (!code || !state || !expectedState || !verifier || !sameState(state, expectedState)) return resultRedirect(request, "invalid");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.redirect(new URL("/auth/mfa", request.url));

  try {
    const config = microsoftConfig(request.nextUrl.origin);
    const tokenResponse = await fetch(`https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri,
        code_verifier: verifier,
        scope: microsoftGraphConnector.scopes.join(" "),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!tokenResponse.ok) return resultRedirect(request, "failed");
    const tokens = await tokenResponse.json() as TokenResponse;
    if (!tokens.access_token) return resultRedirect(request, "failed");

    const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName", {
      headers: { authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!profileResponse.ok) return resultRedirect(request, "failed");
    const profile = await profileResponse.json() as MicrosoftProfile;
    const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
    if (!encryptionKey || !profile.id) return resultRedirect(request, "failed");
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    const encryptedCredentials = encryptCredential({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenType: tokens.token_type,
      scope: tokens.scope,
      expiresAt,
    }, encryptionKey);

    const accountIdentifier = profile.mail ?? profile.userPrincipalName ?? profile.id;
    const { data: existing } = await supabase.from("connections").select("id")
      .eq("owner_id", user.id).eq("provider", microsoftGraphConnector.id)
      .eq("account_identifier", accountIdentifier).maybeSingle();
    const values = {
      owner_id: user.id,
      provider: microsoftGraphConnector.id,
      account_name: profile.displayName ?? accountIdentifier,
      account_identifier: accountIdentifier,
      status: "connected",
      health_status: "healthy",
      capabilities: microsoftGraphConnector.capabilities,
      scopes: [...microsoftGraphConnector.scopes],
      encrypted_credentials: encryptedCredentials,
      token_metadata: { microsoft_profile_id: profile.id, expires_at: expiresAt },
      updated_at: new Date().toISOString(),
    };
    const query = existing?.id
      ? supabase.from("connections").update(values).eq("id", existing.id)
      : supabase.from("connections").insert(values);
    const { error: saveError } = await query;
    if (saveError) return resultRedirect(request, "failed");
    return resultRedirect(request, "connected");
  } catch {
    return resultRedirect(request, "failed");
  }
}
