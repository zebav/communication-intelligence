import { NextResponse, type NextRequest } from "next/server";

export function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  return NextResponse.json({
    issuer: origin,
    authorization_endpoint: origin + "/api/oauth/authorize",
    token_endpoint: origin + "/api/oauth/token",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["contacts.read", "contacts.write"],
    token_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  }, { headers: { "Cache-Control": "no-store" } });
}
