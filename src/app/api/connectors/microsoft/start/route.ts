import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { authorizationUrl, createOAuthAttempt, microsoftConfig, MICROSOFT_OAUTH_COOKIE_PATH } from "@/lib/connectors/microsoft-oauth";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.redirect(new URL("/auth/mfa", request.url));

  try {
    const config = microsoftConfig(request.nextUrl.origin);
    const attempt = createOAuthAttempt();
    const cookieStore = await cookies();
    const options = { httpOnly: true, secure: true, sameSite: "lax" as const, maxAge: 600, path: MICROSOFT_OAUTH_COOKIE_PATH };
    cookieStore.set("microsoft_oauth_state", attempt.state, options);
    cookieStore.set("microsoft_oauth_verifier", attempt.verifier, options);
    return NextResponse.redirect(authorizationUrl(config, attempt.state, attempt.challenge));
  } catch {
    return NextResponse.redirect(new URL("/?connection_error=configuration", request.url));
  }
}
