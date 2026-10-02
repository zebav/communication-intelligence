import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveContactForChatGPT, setContactAvatarFromBytes } from "@/lib/chatgpt-contact-avatar";
import { hasScope, resolveMcpAccessToken } from "@/lib/mcp-oauth";

export const runtime = "nodejs";

const PROTOCOL_VERSION = "2025-06-18";

function rpc(id: unknown, result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id, result }, { headers: { "Cache-Control": "no-store" } });
}

function rpcError(id: unknown, code: number, message: string, data?: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } }, { headers: { "Cache-Control": "no-store" } });
}

const fileSchema = {
  type: "object",
  properties: {
    download_url: { type: "string" },
    file_id: { type: "string" },
    mime_type: { type: "string" },
    file_name: { type: "string" },
  },
  required: ["download_url", "file_id"],
  additionalProperties: false,
};

const tools = [
  {
    name: "find_contacts",
    title: "Find Solvani contacts",
    description: "Find a Solvani contact by name before reading or changing that contact. Use this when a stable person ID is not already known.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", minLength: 1 } },
      required: ["query"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        contacts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              person_id: { type: "string" },
              display_name: { type: "string" },
              last_contact_at: { type: ["string", "null"] },
            },
            required: ["person_id", "display_name"],
            additionalProperties: false,
          },
        },
      },
      required: ["contacts"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    securitySchemes: [{ type: "oauth2", scopes: ["contacts.read"] }],
  },
  {
    name: "set_contact_avatar",
    title: "Set Solvani contact avatar",
    description: "Set a user-selected image as the verified avatar for an existing Solvani contact. This changes the contact card and stores the image privately in Solvani. Use only when the user explicitly tells you which contact the image belongs to.",
    inputSchema: {
      type: "object",
      $defs: { OpenAIFile: fileSchema },
      properties: {
        person_id: { type: "string", description: "Stable Solvani person ID returned by find_contacts." },
        file: { $ref: "#/$defs/OpenAIFile" },
      },
      required: ["person_id", "file"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        person_id: { type: "string" },
        asset_id: { type: "string" },
      },
      required: ["ok", "person_id", "asset_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    securitySchemes: [{ type: "oauth2", scopes: ["contacts.write"] }],
    _meta: { "openai/fileParams": ["file"] },
  },
];

async function findContacts(ownerId: string, query: string) {
  const db = createAdminClient();
  const escaped = query.trim().replace(/[%_]/g, "\\$&");
  const { data, error } = await db.from("people")
    .select("id,display_name,last_contact_at")
    .eq("owner_id", ownerId)
    .ilike("display_name", `%${escaped}%`)
    .or("relationship_status.is.null,relationship_status.neq.merged")
    .order("last_contact_at", { ascending: false, nullsFirst: false })
    .limit(10);
  if (error) throw new Error("Could not search contacts.");
  return (data ?? []).map((row) => ({
    person_id: row.id,
    display_name: row.display_name,
    last_contact_at: row.last_contact_at,
  }));
}

async function downloadImage(file: { download_url: string; mime_type?: string; file_name?: string }) {
  const url = new URL(file.download_url);
  if (url.protocol !== "https:") throw new Error("Only HTTPS file URLs are allowed.");
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Could not download image (${response.status}).`);
  const contentLength = Number(response.headers.get("content-length") || "0");
  if (contentLength > 5 * 1024 * 1024) throw new Error("Image must be 5 MB or smaller.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 5 * 1024 * 1024) throw new Error("Image must be 5 MB or smaller.");
  const mimeType = (file.mime_type || response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  return { bytes, mimeType, filename: file.file_name || "contact-avatar" };
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    },
  });
}

export async function POST(request: NextRequest) {
  const authorization = await resolveMcpAccessToken(request.headers.get("authorization"));
  if (!authorization) {
    const metadata = request.nextUrl.origin + "/.well-known/oauth-protected-resource";
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } },
      { status: 401, headers: { "WWW-Authenticate": `Bearer resource_metadata="${metadata}", scope="contacts.read contacts.write"`, "Cache-Control": "no-store" } },
    );
  }
  const ownerId = authorization.ownerId;

  let message: { jsonrpc?: string; id?: unknown; method?: string; params?: any };
  try {
    message = await request.json();
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  const id = message.id ?? null;
  try {
    if (message.method === "initialize") {
      return rpc(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "solvani", version: "1.0.0" },
        instructions: "Use find_contacts before changing a contact when the stable person ID is not known. Only set a contact avatar when the user explicitly identifies who the image belongs to.",
      });
    }
    if (message.method === "notifications/initialized") {
      return new NextResponse(null, { status: 202 });
    }
    if (message.method === "tools/list") {
      return rpc(id, { tools });
    }
    if (message.method === "tools/call") {
      const name = String(message.params?.name ?? "");
      const args = message.params?.arguments ?? {};
      if (name === "find_contacts") {
        if (!hasScope(authorization.scope, "contacts.read")) return rpcError(id, -32003, "Missing contacts.read scope");
        const query = String(args.query ?? "").trim();
        if (!query) return rpcError(id, -32602, "query is required");
        const contacts = await findContacts(ownerId, query);
        return rpc(id, {
          content: [{ type: "text", text: contacts.length ? `Found ${contacts.length} matching contact(s).` : "No matching contacts found." }],
          structuredContent: { contacts },
        });
      }
      if (name === "set_contact_avatar") {
        if (!hasScope(authorization.scope, "contacts.write")) return rpcError(id, -32003, "Missing contacts.write scope");
        const personId = String(args.person_id ?? "").trim();
        const file = args.file as { download_url?: string; file_id?: string; mime_type?: string; file_name?: string } | undefined;
        if (!personId || !file?.download_url || !file.file_id) return rpcError(id, -32602, "person_id and file are required");
        await resolveContactForChatGPT(ownerId, { personId });
        const downloaded = await downloadImage({
          download_url: file.download_url,
          mime_type: file.mime_type,
          file_name: file.file_name,
        });
        const saved = await setContactAvatarFromBytes({
          ownerId,
          personId,
          bytes: downloaded.bytes,
          mimeType: downloaded.mimeType,
          filename: downloaded.filename,
          source: "chatgpt_mcp",
        });
        return rpc(id, {
          content: [{ type: "text", text: "Contact avatar updated in Solvani." }],
          structuredContent: { ok: true, person_id: saved.personId, asset_id: saved.assetId },
        });
      }
      return rpcError(id, -32601, "Unknown tool");
    }
    if (message.method === "ping") return rpc(id, {});
    return rpcError(id, -32601, "Method not found");
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unexpected Solvani error.";
    return rpc(id, {
      content: [{ type: "text", text: detail }],
      isError: true,
    });
  }
}

export async function GET() {
  return NextResponse.json({
    name: "Solvani MCP",
    transport: "streamable-http",
    tools: tools.map((tool) => tool.name),
  }, { headers: { "Cache-Control": "no-store" } });
}
