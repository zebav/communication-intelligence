import { randomBytes } from "node:crypto";
import { instagramConnector } from "./instagram";

export const INSTAGRAM_OAUTH_COOKIE_PATH = "/api/connectors/instagram";
export const SOLVANI_PRODUCTION_ORIGIN = "https://www.solvani.app";

type InstagramOAuthEnvironment = {
  INSTAGRAM_REDIRECT_URI?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  VERCEL_ENV?: string;
  NODE_ENV?: string;
};

function isStableSolvaniCallback(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && (url.hostname === "www.solvani.app" || url.hostname === "solvani.app")
      && url.pathname === "/api/connectors/instagram/callback";
  } catch {
    return false;
  }
}

/**
 * Meta callbacks must use one stable public origin. Earlier deployments used a
 * changing Vercel alias, which meant a reconnect or webhook configuration
 * could silently point at an old build. Preview requests safely bounce to the
 * stable app in production; local development still uses its supplied origin.
 */
export function instagramRedirectUri(origin: string, environment?: InstagramOAuthEnvironment) {
  const configuredEnvironment = environment ?? process.env;
  if (isStableSolvaniCallback(configuredEnvironment.INSTAGRAM_REDIRECT_URI)) return configuredEnvironment.INSTAGRAM_REDIRECT_URI!;
  const runningInVercel = Boolean(configuredEnvironment.VERCEL_PROJECT_PRODUCTION_URL || configuredEnvironment.VERCEL_ENV);
  if (configuredEnvironment.NODE_ENV === "production" || runningInVercel) return `${SOLVANI_PRODUCTION_ORIGIN}/api/connectors/instagram/callback`;
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
