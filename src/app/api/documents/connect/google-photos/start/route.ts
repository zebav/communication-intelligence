import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createGoogleOAuthAttempt, googleAuthorizationUrl, googleConfig, GOOGLE_OAUTH_COOKIE_PATH } from "@/lib/connectors/google-oauth";

export async function GET(request: NextRequest) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const { data: assurance } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.redirect(new URL("/auth/mfa", request.url));
  try {
    const config = googleConfig(request.nextUrl.origin);
    const callbackOrigin = new URL(config.redirectUri).origin;
    if (callbackOrigin !== request.nextUrl.origin) return NextResponse.redirect(new URL("/api/documents/connect/google-photos/start", callbackOrigin));
    const attempt = createGoogleOAuthAttempt();
    const options = { httpOnly: true, secure: true, sameSite: "lax" as const, maxAge: 600, path: GOOGLE_OAUTH_COOKIE_PATH };
    const jar = await cookies();
    jar.set("google_oauth_purpose", "photos", options);
    jar.set("google_oauth_state", attempt.state, options);
    jar.set("google_oauth_verifier", attempt.verifier, options);
    return NextResponse.redirect(googleAuthorizationUrl(config, attempt.state, attempt.challenge, "photos"));
  } catch { return NextResponse.redirect(new URL("/?view=settings&settings=documents&documents=configuration&documentProvider=google-photos", request.url)); }
}
