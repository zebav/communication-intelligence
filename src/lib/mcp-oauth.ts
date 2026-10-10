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

/** A non-secret identifier that is safe to show in Settings and audit events. */
export function manualMcpTokenFingerprint(token: string) {
  return token.slice(-8);
}

export function normalizeScopes(scope?: string | null) {
  const requested = new Set((scope ?? "").split(/\s+/).filter(Boolean));
  const allowed = ["contacts.read", "contacts.write"].filter((item) => requested.has(item));
  return allowed.length ? allowed.join(" ") : "contacts.read";
}

export function hasScope(scope: string, required: string) {
  return new Set(scope.split(/\s+/).filter(Boolean)).has(required);
}

export async function resolveMcpAccessToken(authHeader: string | null) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const presented = authHeader.slice(7).trim();
  if (!presented) return null;
  const tokenHash = hashToken(presented);
  const db = createAdminClient();
  const { data, error } = await db.from("solvani_oauth_tokens")
    .select("owner_id,scope,access_expires_at,revoked_at")
    .eq("access_token_hash", tokenHash)
    .maybeSingle();
  if (!error && data && !data.revoked_at && Date.parse(data.access_expires_at) > Date.now()) {
    return { ownerId: data.owner_id as string, scope: data.scope as string, kind: "oauth" as const };
  }

  // Manual tokens are intentionally a separate table: OAuth credentials rotate
  // and expire differently, while this personal bearer token is revocable and
  // never has a refresh token or plaintext server-side representation.
  const { data: manual, error: manualError } = await db.from("solvani_mcp_tokens")
    .select("id,owner_id,scope,expires_at,revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (manualError || !manual || manual.revoked_at || Date.parse(manual.expires_at) <= Date.now()) return null;
  // Usage telemetry is deliberately best effort: authentication must stay
  // available if a non-critical timestamp write is temporarily unavailable.
  void db.from("solvani_mcp_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", manual.id);
  return { ownerId: manual.owner_id as string, scope: manual.scope as string, kind: "manual" as const };
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
