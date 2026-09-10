import { createHash, randomBytes } from "node:crypto";
import { googleGmailConnector } from "./google-gmail";

export const GOOGLE_OAUTH_COOKIE_PATH = "/api/connectors/google";

export function googleRedirectUri(origin: string, environment?: { GOOGLE_REDIRECT_URI?: string; VERCEL_PROJECT_PRODUCTION_URL?: string }) {
  const configuredEnvironment = environment ?? process.env;
  if (configuredEnvironment.GOOGLE_REDIRECT_URI) return configuredEnvironment.GOOGLE_REDIRECT_URI;
  if (configuredEnvironment.VERCEL_PROJECT_PRODUCTION_URL) return `https://${configuredEnvironment.VERCEL_PROJECT_PRODUCTION_URL}/api/connectors/google/callback`;
  return `${origin}/api/connectors/google/callback`;
}

export function googleConfig(origin: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth is not configured.");
  return { clientId, clientSecret, redirectUri: googleRedirectUri(origin) };
}

export function createGoogleOAuthAttempt() {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { state, verifier, challenge };
}

export function googleAuthorizationUrl(config: ReturnType<typeof googleConfig>, state: string, challenge: string) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: googleGmailConnector.scopes.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent select_account",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return url;
}
