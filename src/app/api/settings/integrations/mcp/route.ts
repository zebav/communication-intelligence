import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, issueOpaqueToken, manualMcpTokenFingerprint } from "@/lib/mcp-oauth";

export const runtime = "nodejs";

const OWNER_ENV = "CHATGPT_CAPTURE_OWNER_ID";
const MCP_PATH = "/api/mcp";
const DEFAULT_SCOPE = "contacts.read contacts.write";
const TOKEN_LIFETIME_MS = 365 * 24 * 60 * 60_000;
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("generate") }),
  z.object({ action: z.literal("revoke"), id: z.string().uuid() }),
  z.object({ action: z.literal("test"), token: z.string().min(20).max(512) }),
]);

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
}

async function requirePrivateOwner() {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return { error: json({ error: "Logga in för att hantera MCP-anslutningen." }, 401) } as const;
  const { data: assurance } = await session.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return { error: json({ error: "Tvåfaktorsinloggning krävs för MCP-nycklar." }, 403) } as const;
  const configuredOwner = process.env[OWNER_ENV];
  if (!configuredOwner || configuredOwner !== user.id) return { error: json({ error: "Det här kontot får inte skapa privata MCP-nycklar." }, 403) } as const;
  return { user } as const;
}

function safeToken(row: { id: string; fingerprint: string; scope: string; created_at: string; expires_at: string; last_used_at: string | null }) {
  return { id: row.id, fingerprint: row.fingerprint, scope: row.scope, createdAt: row.created_at, expiresAt: row.expires_at, lastUsedAt: row.last_used_at };
}

export async function GET() {
  const auth = await requirePrivateOwner();
  if ("error" in auth) return auth.error;
  const db = createAdminClient();
  const { data, error } = await db.from("solvani_mcp_tokens")
    .select("id,fingerprint,scope,created_at,expires_at,last_used_at")
    .eq("owner_id", auth.user.id)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (error) return json({ error: "MCP-nycklarna kunde inte läsas." }, 500);
  return json({ endpoint: "https://www.solvani.app" + MCP_PATH, tokens: (data ?? []).map(safeToken) });
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return json({ error: "Ogiltigt ursprung." }, 403);
  const auth = await requirePrivateOwner();
  if ("error" in auth) return auth.error;
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Ogiltig MCP-begäran." }, 400);
  const db = createAdminClient();

  if (parsed.data.action === "generate") {
    const now = new Date();
    const { data: current, error: readError } = await db.from("solvani_mcp_tokens")
      .select("id,created_at")
      .eq("owner_id", auth.user.id)
      .is("revoked_at", null)
      .gt("expires_at", now.toISOString())
      .order("created_at", { ascending: false });
    if (readError) return json({ error: "MCP-nycklarna kunde inte kontrolleras." }, 500);
    if ((current ?? []).length >= 3) return json({ error: "Återkalla en befintlig MCP-nyckel innan du skapar en ny." }, 429);
    const latest = current?.[0];
    if (latest && Date.parse(latest.created_at) > Date.now() - 60_000) return json({ error: "Vänta en minut innan du skapar en ny MCP-nyckel." }, 429);
    const token = issueOpaqueToken("slv_mcp_", 32);
    const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString();
    const { data, error } = await db.from("solvani_mcp_tokens").insert({
      owner_id: auth.user.id,
      token_hash: hashToken(token),
      fingerprint: manualMcpTokenFingerprint(token),
      scope: DEFAULT_SCOPE,
      expires_at: expiresAt,
    }).select("id,fingerprint,scope,created_at,expires_at,last_used_at").single();
    if (error || !data) return json({ error: "MCP-nyckeln kunde inte skapas." }, 500);
    await db.from("audit_logs").insert({ owner_id: auth.user.id, actor_id: auth.user.id, actor_type: "user", action: "mcp.manual_token_created", object_type: "mcp_token", object_id: data.id, source: "settings", new_value: { fingerprint: data.fingerprint, scope: DEFAULT_SCOPE, expires_at: expiresAt } });
    return json({ token, tokenInfo: safeToken(data) }, 201);
  }

  if (parsed.data.action === "revoke") {
    const { data, error } = await db.from("solvani_mcp_tokens")
      .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", parsed.data.id).eq("owner_id", auth.user.id).is("revoked_at", null)
      .select("id,fingerprint").maybeSingle();
    if (error || !data) return json({ error: "MCP-nyckeln kunde inte återkallas." }, 404);
    await db.from("audit_logs").insert({ owner_id: auth.user.id, actor_id: auth.user.id, actor_type: "user", action: "mcp.manual_token_revoked", object_type: "mcp_token", object_id: data.id, source: "settings", new_value: { fingerprint: data.fingerprint } });
    return json({ success: true });
  }

  // The bearer value exists only in this incoming request and the internal
  // request below. It is never persisted, added to a URL, audited or logged.
  const endpoint = new URL(MCP_PATH, request.url);
  try {
    const initialize = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${parsed.data.token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "connection-test-initialize", method: "initialize", params: {} }), cache: "no-store" });
    if (!initialize.ok) return json({ error: "Anslutningstestet kunde inte autentisera MCP-nyckeln." }, 409);
    const list = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${parsed.data.token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "connection-test-tools", method: "tools/list", params: {} }), cache: "no-store" });
    const payload = await list.json().catch(() => null) as { result?: { tools?: Array<{ name?: string }> } } | null;
    const names = new Set(payload?.result?.tools?.map((tool) => tool.name) ?? []);
    if (!list.ok || !names.has("find_contacts") || !names.has("set_contact_avatar")) return json({ error: "MCP-svaret saknar förväntade verktyg." }, 409);
    return json({ success: true });
  } catch {
    return json({ error: "MCP-anslutningen kunde inte testas just nu." }, 502);
  }
}
