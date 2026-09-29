import { createHash, randomBytes } from "node:crypto";

export const SLACK_OAUTH_COOKIE_PATH = "/api/connectors/slack";

/**
 * Slack has no refresh token in its standard OAuth V2 response. The token is
 * therefore kept encrypted and can only be used for the explicitly granted,
 * read-only pilot scopes below.
 */
export const slackReadOnlyScopes = [
  "channels:read",
  "channels:history",
  "im:read",
  "im:history",
  "users:read",
] as const;

export function slackRedirectUri(
  origin: string,
  environment?: { SLACK_REDIRECT_URI?: string; VERCEL_PROJECT_PRODUCTION_URL?: string },
) {
  const configuredEnvironment = environment ?? process.env;
  if (configuredEnvironment.SLACK_REDIRECT_URI) return configuredEnvironment.SLACK_REDIRECT_URI;
  if (configuredEnvironment.VERCEL_PROJECT_PRODUCTION_URL) return `https://${configuredEnvironment.VERCEL_PROJECT_PRODUCTION_URL}/api/connectors/slack/callback`;
  return `${origin}/api/connectors/slack/callback`;
}

export function slackConfig(origin: string) {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Slack OAuth is not configured.");
  return { clientId, clientSecret, redirectUri: slackRedirectUri(origin) };
}

export function createSlackOAuthAttempt() {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { state, verifier, challenge };
}

export function slackAuthorizationUrl(config: ReturnType<typeof slackConfig>, state: string, challenge: string) {
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: slackReadOnlyScopes.join(","),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return url;
}
