import { randomBytes } from "node:crypto";
import { instagramConnector } from "./instagram";

export const INSTAGRAM_OAUTH_COOKIE_PATH = "/api/connectors/instagram";

export function instagramRedirectUri(origin: string, environment?: { INSTAGRAM_REDIRECT_URI?: string; VERCEL_PROJECT_PRODUCTION_URL?: string }) {
  const configuredEnvironment = environment ?? process.env;
  if (configuredEnvironment.INSTAGRAM_REDIRECT_URI) return configuredEnvironment.INSTAGRAM_REDIRECT_URI;
  if (configuredEnvironment.VERCEL_PROJECT_PRODUCTION_URL) return `https://${configuredEnvironment.VERCEL_PROJECT_PRODUCTION_URL}/api/connectors/instagram/callback`;
  return `${origin}/api/connectors/instagram/callback`;
}

export function instagramConfig(origin: string) {
  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (!appId || !appSecret) throw new Error("Instagram OAuth is not configured.");
  return { appId, appSecret, redirectUri: instagramRedirectUri(origin) };
}

export function createInstagramOAuthState() {
  return randomBytes(32).toString("base64url");
}

export function instagramAuthorizationUrl(config: ReturnType<typeof instagramConfig>, state: string) {
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: instagramConnector.scopes.join(","),
    state,
    enable_fb_login: "0",
    force_authentication: "1",
  }).toString();
  return url;
}
