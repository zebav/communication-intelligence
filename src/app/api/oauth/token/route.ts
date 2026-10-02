import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, issueOpaqueToken, normalizeScopes, pkceChallenge } from "@/lib/mcp-oauth";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } });
}

async function issueTokenSet(args: { ownerId: string; clientId: string; scope: string; resource: string }) {
  const db = createAdminClient();
  const accessToken = issueOpaqueToken("slv_at_", 32);
  const refreshToken = issueOpaqueToken("slv_rt_", 48);
  const accessExpiresAt = new Date(Date.now() + 60 * 60_000);
  const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000);
  const { error } = await db.from("solvani_oauth_tokens").insert({
    owner_id: args.ownerId,
    access_token_hash: hashToken(accessToken),
    refresh_token_hash: hashToken(refreshToken),
    client_id: args.clientId,
    scope: args.scope,
    resource: args.resource,
    access_expires_at: accessExpiresAt.toISOString(),
    refresh_expires_at: refreshExpiresAt.toISOString(),
  });
  if (error) throw new Error("token_issue_failed");
  return { accessToken, refreshToken, expiresIn: 3600 };
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const grantType = String(form.get("grant_type") ?? "");
    const clientId = String(form.get("client_id") ?? "");
    const resource = String(form.get("resource") ?? "");
    if (!clientId || !resource) return json({ error: "invalid_request" }, 400);

    const db = createAdminClient();

    if (grantType === "authorization_code") {
      const code = String(form.get("code") ?? "");
      const redirectUri = String(form.get("redirect_uri") ?? "");
      const verifier = String(form.get("code_verifier") ?? "");
      if (!code || !redirectUri || !verifier) return json({ error: "invalid_request" }, 400);

      const { data, error } = await db.from("solvani_oauth_codes")
        .select("id,owner_id,client_id,redirect_uri,code_challenge,scope,resource,expires_at,used_at")
        .eq("code_hash", hashToken(code))
        .maybeSingle();
      if (error || !data || data.used_at || Date.parse(data.expires_at) <= Date.now()) {
        return json({ error: "invalid_grant" }, 400);
      }
      if (data.client_id !== clientId || data.redirect_uri !== redirectUri || data.resource !== resource) {
        return json({ error: "invalid_grant" }, 400);
      }
      if (pkceChallenge(verifier) !== data.code_challenge) {
        return json({ error: "invalid_grant" }, 400);
      }
      const { data: claimedCode, error: usedError } = await db.from("solvani_oauth_codes")
        .update({ used_at: new Date().toISOString() })
        .eq("id", data.id)
        .is("used_at", null)
        .select("id")
        .maybeSingle();
      if (usedError || !claimedCode) return json({ error: "invalid_grant" }, 400);

      const issued = await issueTokenSet({
        ownerId: data.owner_id,
        clientId,
        scope: normalizeScopes(data.scope),
        resource,
      });
      return json({
        access_token: issued.accessToken,
        token_type: "Bearer",
        expires_in: issued.expiresIn,
        refresh_token: issued.refreshToken,
        scope: normalizeScopes(data.scope),
      });
    }

    if (grantType === "refresh_token") {
      const refreshToken = String(form.get("refresh_token") ?? "");
      if (!refreshToken) return json({ error: "invalid_request" }, 400);
      const { data, error } = await db.from("solvani_oauth_tokens")
        .select("id,owner_id,client_id,scope,resource,refresh_expires_at,revoked_at")
        .eq("refresh_token_hash", hashToken(refreshToken))
        .maybeSingle();
      if (error || !data || data.revoked_at || Date.parse(data.refresh_expires_at) <= Date.now()) {
        return json({ error: "invalid_grant" }, 400);
      }
      if (data.client_id !== clientId || data.resource !== resource) return json({ error: "invalid_grant" }, 400);

      await db.from("solvani_oauth_tokens").update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", data.id);

      const issued = await issueTokenSet({
        ownerId: data.owner_id,
        clientId,
        scope: normalizeScopes(data.scope),
        resource,
      });
      return json({
        access_token: issued.accessToken,
        token_type: "Bearer",
        expires_in: issued.expiresIn,
        refresh_token: issued.refreshToken,
        scope: normalizeScopes(data.scope),
      });
    }

    return json({ error: "unsupported_grant_type" }, 400);
  } catch {
    return json({ error: "server_error" }, 500);
  }
}
