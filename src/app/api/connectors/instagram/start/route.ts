import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createInstagramOAuthState, instagramAuthorizationUrl, instagramConfig, INSTAGRAM_OAUTH_COOKIE_PATH } from "@/lib/connectors/instagram-oauth";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.redirect(new URL("/auth/mfa", request.url));

  try {
    const config = instagramConfig(request.nextUrl.origin);
    const callbackOrigin = new URL(config.redirectUri).origin;
    if (callbackOrigin !== request.nextUrl.origin) return NextResponse.redirect(new URL(`${INSTAGRAM_OAUTH_COOKIE_PATH}/start`, callbackOrigin));
    const state = createInstagramOAuthState();
    (await cookies()).set("instagram_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: INSTAGRAM_OAUTH_COOKIE_PATH });
    return NextResponse.redirect(instagramAuthorizationUrl(config, state));
  } catch {
    return NextResponse.redirect(new URL("/?instagram=configuration", request.url));
  }
}
