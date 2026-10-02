import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function pkceChallenge(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

export function issueOpaqueToken(prefix: string, bytes = 32) {
  return prefix + randomBytes(bytes).toString("base64url");
}

export function normalizeScopes(scope?: string | null) {
  const requested = new Set((scope ?? "").split(/\s+/).filter(Boolean));
  const allowed = ["contacts.read", "contacts.write"].filter((item) => requested.has(item));
  return allowed.length ? allowed.join(" ") : "contacts.read contacts.write";
}

export function hasScope(scope: string, required: string) {
  return new Set(scope.split(/\s+/).filter(Boolean)).has(required);
}

export async function resolveMcpAccessToken(authHeader: string | null) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const tokenHash = hashToken(authHeader.slice(7));
  const db = createAdminClient();
  const { data, error } = await db.from("solvani_oauth_tokens")
    .select("owner_id,scope,access_expires_at,revoked_at")
    .eq("access_token_hash", tokenHash)
    .maybeSingle();
  if (error || !data || data.revoked_at) return null;
  if (Date.parse(data.access_expires_at) <= Date.now()) return null;
  return { ownerId: data.owner_id as string, scope: data.scope as string };
}

export async function validateChatGptClient(clientId: string, redirectUri: string) {
  const clientUrl = new URL(clientId);
  const redirect = new URL(redirectUri);
  if (clientUrl.protocol !== "https:" || clientUrl.hostname !== "chatgpt.com") return false;
  if (!clientUrl.pathname.startsWith("/oauth/") || !clientUrl.pathname.endsWith("/client.json")) return false;
  if (redirect.protocol !== "https:" || redirect.hostname !== "chatgpt.com") return false;
  if (!(redirect.pathname === "/connector_platform_oauth_redirect" || redirect.pathname.startsWith("/connector/oauth/"))) return false;
  try {
    const response = await fetch(clientId, { signal: AbortSignal.timeout(7000), cache: "no-store" });
    if (!response.ok) return false;
    const metadata = await response.json() as { redirect_uris?: string[] };
    return Array.isArray(metadata.redirect_uris) && metadata.redirect_uris.includes(redirectUri);
  } catch {
    return false;
  }
}
