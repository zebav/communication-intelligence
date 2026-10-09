import "server-only";

import { createHash } from "node:crypto";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const MANUAL_MCP_CLIENT_ID = "chatgpt-manual-mcp";
export const MANUAL_MCP_RESOURCE = "https://www.solvani.app/api/mcp";
export const MANUAL_MCP_SCOPE = "contacts.read contacts.write";
export const MANUAL_MCP_TTL_MS = 365 * 24 * 60 * 60 * 1000;
export const MANUAL_MCP_MAX_ACTIVE_TOKENS = 5;
export const MANUAL_MCP_GENERATION_COOLDOWN_MS = 60 * 1000;

export class ManualMcpTokenError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export function configuredMcpOwnerId() {
  return process.env.SOLVANI_PRIVATE_OWNER_ID || process.env.CHATGPT_CAPTURE_OWNER_ID || null;
}

export function isConfiguredMcpOwner(ownerId: string) {
  return configuredMcpOwnerId() === ownerId;
}

export function manualMcpTokenFingerprint(token: string) {
  return token.slice(-8);
}

export function isManualMcpToken(token: string) {
  return /^slv_mcp_[A-Za-z0-9_-]{32,128}$/.test(token);
}

function hashManualMcpToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function requirePrivateMcpOwner() {
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) throw new ManualMcpTokenError(401, "Sign in again to manage Solvani MCP tokens.");
  if (!isConfiguredMcpOwner(user.id)) throw new ManualMcpTokenError(403, "This account is not allowed to manage private Solvani MCP tokens.");
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") throw new ManualMcpTokenError(403, "Two-factor authentication is required.");
  return user;
}

export async function resolveManualMcpAccessToken(token: string) {
  if (!isManualMcpToken(token)) return null;
  const database = createAdminClient();
  const { data, error } = await database
    .from("solvani_mcp_tokens")
    .select("id,owner_id,scope,expires_at,revoked_at")
    .eq("token_hash", hashManualMcpToken(token))
    .maybeSingle();

  if (error || !data || data.revoked_at || Date.parse(data.expires_at) <= Date.now()) return null;

  // This metadata update is deliberately best-effort: an otherwise valid MCP
  // call must not fail merely because observability storage is temporarily slow.
  await database
    .from("solvani_mcp_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  return { ownerId: data.owner_id as string, scope: data.scope as string };
}

export function requestHasSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}
