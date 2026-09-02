import { createHash, randomBytes } from "node:crypto";
import { microsoftGraphConnector } from "./microsoft-graph";

export const MICROSOFT_OAUTH_COOKIE_PATH = "/api/connectors/microsoft";

export function microsoftConfig(origin: string) {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const tenant = process.env.MICROSOFT_TENANT ?? "common";
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI ?? `${origin}/api/connectors/microsoft/callback`;
  if (!clientId || !clientSecret) throw new Error("Microsoft OAuth is not configured.");
  if (!/^[a-zA-Z0-9.-]+$/.test(tenant)) throw new Error("Invalid Microsoft tenant configuration.");
  return { clientId, clientSecret, tenant, redirectUri };
}

export function createOAuthAttempt() {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { state, verifier, challenge };
}

export function authorizationUrl(config: ReturnType<typeof microsoftConfig>, state: string, challenge: string) {
  const url = new URL(`https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    response_mode: "query",
    scope: microsoftGraphConnector.scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url;
}
