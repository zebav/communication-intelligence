import { NextResponse, type NextRequest } from "next/server";

export function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  return NextResponse.json({
    resource: origin + "/api/mcp",
    authorization_servers: [origin],
    scopes_supported: ["contacts.read", "contacts.write"],
    resource_documentation: origin + "/api/integrations/chatgpt/openapi",
  }, { headers: { "Cache-Control": "no-store" } });
}
