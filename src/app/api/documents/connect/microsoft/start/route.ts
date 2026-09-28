import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { authorizationUrl, createOAuthAttempt, microsoftConfig, MICROSOFT_OAUTH_COOKIE_PATH } from "@/lib/connectors/microsoft-oauth";
import { microsoftOneDriveScopes } from "@/lib/documents/cloud-connections";

export async function GET(request: NextRequest) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const { data: assurance } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.redirect(new URL("/auth/mfa", request.url));
  try {
    const config = microsoftConfig(request.nextUrl.origin);
    const callbackOrigin = new URL(config.redirectUri).origin;
    if (callbackOrigin !== request.nextUrl.origin) return NextResponse.redirect(new URL("/api/documents/connect/microsoft/start", callbackOrigin));
    const attempt = createOAuthAttempt();
    const options = { httpOnly: true, secure: true, sameSite: "lax" as const, maxAge: 600, path: MICROSOFT_OAUTH_COOKIE_PATH };
    const jar = await cookies();
    jar.set("microsoft_oauth_purpose", "onedrive", options);
    jar.set("microsoft_oauth_state", attempt.state, options);
    jar.set("microsoft_oauth_verifier", attempt.verifier, options);
    return NextResponse.redirect(authorizationUrl(config, attempt.state, attempt.challenge, microsoftOneDriveScopes));
  } catch { return NextResponse.redirect(new URL("/?documents=configuration", request.url)); }
}
