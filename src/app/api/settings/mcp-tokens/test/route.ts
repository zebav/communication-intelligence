import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { MANUAL_MCP_RESOURCE, ManualMcpTokenError, requestHasSameOrigin, requirePrivateMcpOwner, resolveManualMcpAccessToken } from "@/lib/manual-mcp-tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store, private", Pragma: "no-cache" };
const schema = z.object({ token: z.string().regex(/^slv_mcp_[A-Za-z0-9_-]{32,128}$/) });

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

async function mcpCall(token: string, body: Record<string, unknown>) {
  const response = await fetch(MANUAL_MCP_RESOURCE, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-06-18",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("MCP endpoint rejected the token.");
  return response.json() as Promise<{ result?: { tools?: Array<{ name?: string }> } }>;
}

export async function POST(request: NextRequest) {
  if (!requestHasSameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return json({ error: "Invalid token format." }, 400);
    const user = await requirePrivateMcpOwner();
    const tokenAccess = await resolveManualMcpAccessToken(parsed.data.token);
    if (!tokenAccess || tokenAccess.ownerId !== user.id) return json({ error: "This is not an active token for your Solvani workspace." }, 403);
    await mcpCall(parsed.data.token, { jsonrpc: "2.0", id: "manual-token-initialize", method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Solvani MCP settings", version: "1.0" } } });
    const toolsResponse = await mcpCall(parsed.data.token, { jsonrpc: "2.0", id: "manual-token-tools", method: "tools/list" });
    const tools = new Set((toolsResponse.result?.tools ?? []).map((tool) => tool.name));
    if (!tools.has("find_contacts") || !tools.has("set_contact_avatar")) throw new Error("Expected MCP tools were not available.");
    return json({ ok: true, tools: ["find_contacts", "set_contact_avatar"] });
  } catch (error) {
    if (error instanceof ManualMcpTokenError) return json({ error: error.message }, error.status);
    return json({ error: "Solvani could not verify the MCP connection. The token remains valid and can be retried." }, 502);
  }
}
