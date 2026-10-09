import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { ManualMcpTokenError, requestHasSameOrigin, requirePrivateMcpOwner } from "@/lib/manual-mcp-tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store, private", Pragma: "no-cache" };
const schema = z.object({ tokenId: z.string().uuid() });

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

export async function POST(request: NextRequest) {
  if (!requestHasSameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return json({ error: "Invalid request." }, 400);
    const user = await requirePrivateMcpOwner();
    const database = createAdminClient();
    const { data: token, error: lookupError } = await database
      .from("solvani_mcp_tokens")
      .select("id,token_fingerprint,scope,revoked_at")
      .eq("id", parsed.data.tokenId)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!token) return json({ error: "That MCP token is no longer available." }, 404);
    if (token.revoked_at) return json({ ok: true });
    const revokedAt = new Date().toISOString();
    const { error: revokeError } = await database
      .from("solvani_mcp_tokens")
      .update({ revoked_at: revokedAt })
      .eq("id", token.id)
      .eq("owner_id", user.id)
      .is("revoked_at", null);
    if (revokeError) throw revokeError;
    await database.from("audit_logs").insert({
      owner_id: user.id,
      actor_id: user.id,
      action: "mcp.manual_token_revoked",
      object_type: "solvani_mcp_token",
      object_id: token.id,
      source: "settings",
      actor_type: "user",
      previous_value: { token_fingerprint: token.token_fingerprint, scope: token.scope },
      new_value: { revoked_at: revokedAt },
    });
    return json({ ok: true });
  } catch (error) {
    if (error instanceof ManualMcpTokenError) return json({ error: error.message }, error.status);
    return json({ error: "The MCP token could not be revoked." }, 500);
  }
}
