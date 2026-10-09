import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, issueOpaqueToken } from "@/lib/mcp-oauth";
import {
  MANUAL_MCP_GENERATION_COOLDOWN_MS,
  MANUAL_MCP_MAX_ACTIVE_TOKENS,
  MANUAL_MCP_RESOURCE,
  MANUAL_MCP_SCOPE,
  MANUAL_MCP_TTL_MS,
  ManualMcpTokenError,
  manualMcpTokenFingerprint,
  requestHasSameOrigin,
  requirePrivateMcpOwner,
} from "@/lib/manual-mcp-tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store, private", Pragma: "no-cache" };
const bodySchema = z.object({ action: z.literal("generate") });

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

function publicTokenRecord<T extends { expires_at: string; revoked_at: string | null }>(token: T) {
  return {
    ...token,
    status: token.revoked_at ? "revoked" : Date.parse(token.expires_at) <= Date.now() ? "expired" : "active",
  } as T & { status: "active" | "expired" | "revoked" };
}

function errorResponse(error: unknown) {
  if (error instanceof ManualMcpTokenError) return json({ error: error.message }, error.status);
  return json({ error: "The MCP token operation could not be completed." }, 500);
}

export async function GET() {
  try {
    const user = await requirePrivateMcpOwner();
    const database = createAdminClient();
    const { data, error } = await database
      .from("solvani_mcp_tokens")
      .select("id,token_fingerprint,scope,created_at,expires_at,revoked_at,last_used_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return json({ tokens: (data ?? []).map(publicTokenRecord) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  if (!requestHasSameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return json({ error: "Invalid request." }, 400);

    const user = await requirePrivateMcpOwner();
    const database = createAdminClient();
    const now = Date.now();
    const { data: recent, error: recentError } = await database
      .from("solvani_mcp_tokens")
      .select("created_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recentError) throw recentError;
    if (recent && now - Date.parse(recent.created_at) < MANUAL_MCP_GENERATION_COOLDOWN_MS) {
      return json({ error: "Wait one minute before generating another MCP token." }, 429);
    }

    const { count, error: countError } = await database
      .from("solvani_mcp_tokens")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", user.id)
      .is("revoked_at", null)
      .gt("expires_at", new Date(now).toISOString());
    if (countError) throw countError;
    if ((count ?? 0) >= MANUAL_MCP_MAX_ACTIVE_TOKENS) {
      return json({ error: "Revoke an existing MCP token before creating another one." }, 409);
    }

    const token = issueOpaqueToken("slv_mcp_", 32);
    const expiresAt = new Date(now + MANUAL_MCP_TTL_MS).toISOString();
    const { data: saved, error: saveError } = await database
      .from("solvani_mcp_tokens")
      .insert({
        owner_id: user.id,
        token_hash: hashToken(token),
        token_fingerprint: manualMcpTokenFingerprint(token),
        scope: MANUAL_MCP_SCOPE,
        resource: MANUAL_MCP_RESOURCE,
        expires_at: expiresAt,
      })
      .select("id,token_fingerprint,scope,created_at,expires_at,revoked_at,last_used_at")
      .single();
    if (saveError || !saved) throw saveError ?? new Error("Token creation did not return a record.");

    await database.from("audit_logs").insert({
      owner_id: user.id,
      actor_id: user.id,
      action: "mcp.manual_token_created",
      object_type: "solvani_mcp_token",
      object_id: saved.id,
      source: "settings",
      actor_type: "user",
      new_value: { token_fingerprint: saved.token_fingerprint, scope: saved.scope, expires_at: saved.expires_at },
    });

    // The plaintext token is returned exactly once and is intentionally never
    // persisted in the database, audit log, URL, or application state.
    return json({ token, tokenRecord: publicTokenRecord(saved) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
