import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createGoogleOAuthAttempt, googleAuthorizationUrl, googleConfig, GOOGLE_OAUTH_COOKIE_PATH } from "@/lib/connectors/google-oauth";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.redirect(new URL("/auth/mfa", request.url));

  try {
    const config = googleConfig(request.nextUrl.origin);
    const callbackOrigin = new URL(config.redirectUri).origin;
    if (callbackOrigin !== request.nextUrl.origin) return NextResponse.redirect(new URL(`${GOOGLE_OAUTH_COOKIE_PATH}/start`, callbackOrigin));
    const attempt = createGoogleOAuthAttempt();
    const cookieStore = await cookies();
    const options = { httpOnly: true, secure: true, sameSite: "lax" as const, maxAge: 600, path: GOOGLE_OAUTH_COOKIE_PATH };
    cookieStore.set("google_oauth_state", attempt.state, options);
    cookieStore.set("google_oauth_verifier", attempt.verifier, options);
    return NextResponse.redirect(googleAuthorizationUrl(config, attempt.state, attempt.challenge));
  } catch {
    return NextResponse.redirect(new URL("/?google=configuration", request.url));
  }
}
