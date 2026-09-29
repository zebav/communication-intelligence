import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createSlackOAuthAttempt, slackAuthorizationUrl, slackConfig, SLACK_OAUTH_COOKIE_PATH } from "@/lib/connectors/slack-oauth";
import { createClient } from "@/lib/supabase/server";

function settingsRedirect(request: NextRequest, result: "configuration" | "denied" | "failed") {
  return NextResponse.redirect(new URL(`/?view=settings&settings=services&service=slack&slack=${result}`, request.url));
}

export async function GET(request: NextRequest) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const { data: assurance } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.redirect(new URL("/auth/mfa", request.url));

  try {
    const config = slackConfig(request.nextUrl.origin);
    const callbackOrigin = new URL(config.redirectUri).origin;
    if (callbackOrigin !== request.nextUrl.origin) return NextResponse.redirect(new URL(`${SLACK_OAUTH_COOKIE_PATH}/start`, callbackOrigin));
    const attempt = createSlackOAuthAttempt();
    const jar = await cookies();
    const options = { httpOnly: true, secure: true, sameSite: "lax" as const, maxAge: 600, path: SLACK_OAUTH_COOKIE_PATH };
    jar.set("slack_oauth_state", attempt.state, options);
    jar.set("slack_oauth_verifier", attempt.verifier, options);
    return NextResponse.redirect(slackAuthorizationUrl(config, attempt.state, attempt.challenge));
  } catch {
    return settingsRedirect(request, "configuration");
  }
}
