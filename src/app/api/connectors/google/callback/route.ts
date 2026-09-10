import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { decryptCredential, encryptCredential } from "@/lib/connectors/credential-crypto";
import { googleGmailConnector } from "@/lib/connectors/google-gmail";
import { googleConfig } from "@/lib/connectors/google-oauth";
import { createClient } from "@/lib/supabase/server";

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; token_type?: string };
type GoogleProfile = { sub?: string; name?: string; email?: string; hd?: string };

function sameState(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function resultRedirect(request: NextRequest, result: "connected" | "denied" | "invalid" | "failed") {
  return NextResponse.redirect(new URL(`/?google=${result}`, request.url));
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("error")) return resultRedirect(request, "denied");
  const code = request.nextUrl.searchParams.get("code"); const state = request.nextUrl.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("google_oauth_state")?.value; const verifier = cookieStore.get("google_oauth_verifier")?.value;
  cookieStore.delete("google_oauth_state"); cookieStore.delete("google_oauth_verifier");
  if (!code || !state || !expectedState || !verifier || !sameState(state, expectedState)) return resultRedirect(request, "invalid");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.redirect(new URL("/auth/mfa", request.url));

  try {
    const config = googleConfig(request.nextUrl.origin);
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: config.redirectUri }), signal: AbortSignal.timeout(15_000) });
    if (!tokenResponse.ok) return resultRedirect(request, "failed");
    const tokens = await tokenResponse.json() as TokenResponse;
    if (!tokens.access_token || !tokens.expires_in) return resultRedirect(request, "failed");
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(15_000) });
    if (!profileResponse.ok) return resultRedirect(request, "failed");
    const profile = await profileResponse.json() as GoogleProfile;
    const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
    if (!encryptionKey || !profile.sub || !profile.email) return resultRedirect(request, "failed");
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    const { data: existing } = await supabase.from("connections").select("id,encrypted_credentials").eq("owner_id", user.id).eq("provider", googleGmailConnector.id).eq("account_identifier", profile.email.toLowerCase()).maybeSingle();
    let refreshToken = tokens.refresh_token;
    if (!refreshToken && existing?.encrypted_credentials) {
      refreshToken = decryptCredential<{ refreshToken?: string }>(existing.encrypted_credentials, encryptionKey).refreshToken;
    }
    if (!refreshToken) return resultRedirect(request, "failed");
    const encryptedCredentials = encryptCredential({ accessToken: tokens.access_token, refreshToken, tokenType: tokens.token_type, scope: tokens.scope, expiresAt }, encryptionKey);
    const values = { owner_id: user.id, provider: googleGmailConnector.id, source: "email", account_name: profile.name ?? profile.email, account_identifier: profile.email.toLowerCase(), status: "connected", health_status: "healthy", capabilities: googleGmailConnector.capabilities, scopes: [...googleGmailConnector.scopes], encrypted_credentials: encryptedCredentials, token_metadata: { google_profile_id: profile.sub, workspace_domain: profile.hd ?? null, expires_at: expiresAt }, updated_at: new Date().toISOString() };
    const query = existing?.id ? supabase.from("connections").update(values).eq("id", existing.id) : supabase.from("connections").insert(values);
    const { error } = await query;
    return error ? resultRedirect(request, "failed") : resultRedirect(request, "connected");
  } catch (error) {
    console.error("Google OAuth callback failed", { reason: error instanceof Error ? error.message : "unknown" });
    return resultRedirect(request, "failed");
  }
}
