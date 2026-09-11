import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { encryptCredential } from "@/lib/connectors/credential-crypto";
import { instagramConnector } from "@/lib/connectors/instagram";
import { instagramConfig } from "@/lib/connectors/instagram-oauth";
import { createClient } from "@/lib/supabase/server";

type ShortToken = { access_token?: string; user_id?: number; permissions?: string[] };
type LongToken = { access_token?: string; token_type?: string; expires_in?: number };
type InstagramProfile = { user_id?: string; id?: string; username?: string; name?: string; account_type?: string };

function sameState(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function resultRedirect(request: NextRequest, result: "connected" | "denied" | "invalid" | "failed") {
  return NextResponse.redirect(new URL(`/?instagram=${result}`, request.url));
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("error")) return resultRedirect(request, "denied");
  const code = request.nextUrl.searchParams.get("code")?.replace(/#_$/, "");
  const state = request.nextUrl.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("instagram_oauth_state")?.value;
  cookieStore.delete("instagram_oauth_state");
  if (!code || !state || !expectedState || !sameState(state, expectedState)) return resultRedirect(request, "invalid");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.redirect(new URL("/auth/mfa", request.url));

  try {
    const config = instagramConfig(request.nextUrl.origin);
    const tokenResponse = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      body: new URLSearchParams({ client_id: config.appId, client_secret: config.appSecret, grant_type: "authorization_code", redirect_uri: config.redirectUri, code }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!tokenResponse.ok) return resultRedirect(request, "failed");
    const shortToken = await tokenResponse.json() as ShortToken;
    if (!shortToken.access_token) return resultRedirect(request, "failed");

    const longTokenUrl = new URL("https://graph.instagram.com/access_token");
    longTokenUrl.search = new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: config.appSecret, access_token: shortToken.access_token }).toString();
    const longTokenResponse = await fetch(longTokenUrl, { signal: AbortSignal.timeout(15_000) });
    const longToken = longTokenResponse.ok ? await longTokenResponse.json() as LongToken : { access_token: shortToken.access_token, expires_in: 3600 };
    if (!longToken.access_token) return resultRedirect(request, "failed");

    const profileUrl = new URL("https://graph.instagram.com/me");
    profileUrl.search = new URLSearchParams({ fields: "user_id,username,name,account_type", access_token: longToken.access_token }).toString();
    const profileResponse = await fetch(profileUrl, { signal: AbortSignal.timeout(15_000) });
    if (!profileResponse.ok) return resultRedirect(request, "failed");
    const profile = await profileResponse.json() as InstagramProfile;
    const accountId = String(profile.user_id ?? profile.id ?? shortToken.user_id ?? "");
    const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
    if (!accountId || !encryptionKey) return resultRedirect(request, "failed");

    const expiresAt = new Date(Date.now() + (longToken.expires_in ?? 3600) * 1000).toISOString();
    const encryptedCredentials = encryptCredential({ accessToken: longToken.access_token, tokenType: longToken.token_type ?? "bearer", expiresAt }, encryptionKey);
    const accountIdentifier = profile.username ? `@${profile.username}` : accountId;
    const { data: existing } = await supabase.from("connections").select("id").eq("owner_id", user.id).eq("provider", instagramConnector.id).eq("account_identifier", accountIdentifier).maybeSingle();
    const values = { owner_id: user.id, provider: instagramConnector.id, source: "instagram", account_name: profile.name ?? profile.username ?? "Instagram account", account_identifier: accountIdentifier, status: "connected", health_status: "healthy", capabilities: instagramConnector.capabilities, scopes: shortToken.permissions?.length ? shortToken.permissions : [...instagramConnector.scopes], encrypted_credentials: encryptedCredentials, token_metadata: { instagram_user_id: accountId, account_type: profile.account_type ?? null, expires_at: expiresAt }, updated_at: new Date().toISOString() };
    const query = existing?.id ? supabase.from("connections").update(values).eq("id", existing.id) : supabase.from("connections").insert(values);
    const { error } = await query;
    return error ? resultRedirect(request, "failed") : resultRedirect(request, "connected");
  } catch (error) {
    console.error("Instagram OAuth callback failed", { reason: error instanceof Error ? error.message : "unknown" });
    return resultRedirect(request, "failed");
  }
}
