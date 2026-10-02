import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, normalizeScopes, validateChatGptClient } from "@/lib/mcp-oauth";

function htmlEscape(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}

async function validateRequest(request: NextRequest, values: Record<string,string>) {
  const origin = request.nextUrl.origin;
  const responseType = values.response_type;
  const clientId = values.client_id;
  const redirectUri = values.redirect_uri;
  const codeChallenge = values.code_challenge;
  const codeChallengeMethod = values.code_challenge_method;
  const resource = values.resource;
  if (responseType !== "code") throw new Error("Unsupported response_type.");
  if (!clientId || !redirectUri || !codeChallenge) throw new Error("Missing OAuth parameters.");
  if (codeChallengeMethod !== "S256") throw new Error("PKCE S256 is required.");
  if (resource !== origin + "/api/mcp") throw new Error("Invalid resource.");
  if (!(await validateChatGptClient(clientId, redirectUri))) throw new Error("Untrusted OAuth client.");
  return { origin, clientId, redirectUri, codeChallenge, resource, scope: normalizeScopes(values.scope), state: values.state ?? "" };
}

async function requireOwner() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error("LOGIN_REQUIRED");
  const expectedOwner = process.env.CHATGPT_CAPTURE_OWNER_ID;
  if (!expectedOwner || user.id !== expectedOwner) throw new Error("This account is not authorized for the private Solvani app.");
  const { data: assurance } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") throw new Error("MFA_REQUIRED");
  return user;
}

export async function GET(request: NextRequest) {
  const values = Object.fromEntries(request.nextUrl.searchParams.entries());
  try {
    const parsed = await validateRequest(request, values);
    await requireOwner();
    const formValues = ["response_type","client_id","redirect_uri","code_challenge","code_challenge_method","scope","resource","state"]
      .map((name) => `<input type="hidden" name="${name}" value="${htmlEscape(values[name] ?? "")}">`).join("");
    const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect Solvani</title><style>body{font-family:system-ui;margin:0;background:#f6f7f8;color:#111}.card{max-width:560px;margin:12vh auto;background:#fff;border:1px solid #ddd;border-radius:18px;padding:28px}button{font:inherit;background:#111;color:#fff;border:0;border-radius:10px;padding:12px 18px;cursor:pointer}.muted{color:#666}</style></head><body><main class="card"><h1>Connect Solvani to ChatGPT</h1><p>ChatGPT is requesting access to find your Solvani contacts and update a contact image when you explicitly ask it to.</p><p class="muted">Requested access: ${htmlEscape(parsed.scope)}</p><form method="post">${formValues}<button type="submit">Allow access</button></form></main></body></html>`;
    return new NextResponse(body, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authorization failed.";
    if (message === "LOGIN_REQUIRED") {
      const returnTo = encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search);
      return NextResponse.redirect(new URL("/login?next=" + returnTo, request.url));
    }
    if (message === "MFA_REQUIRED") {
      const returnTo = encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search);
      return NextResponse.redirect(new URL("/auth/mfa?next=" + returnTo, request.url));
    }
    return new NextResponse(message, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return new NextResponse("Invalid origin.", { status: 403 });
  try {
    await requireOwner();
    const form = await request.formData();
    const values: Record<string,string> = {};
    for (const key of ["response_type","client_id","redirect_uri","code_challenge","code_challenge_method","scope","resource","state"]) {
      values[key] = String(form.get(key) ?? "");
    }
    const parsed = await validateRequest(request, values);
    const code = "slv_code_" + randomBytes(32).toString("base64url");
    const db = createAdminClient();
    const ownerId = process.env.CHATGPT_CAPTURE_OWNER_ID!;
    const { error } = await db.from("solvani_oauth_codes").insert({
      owner_id: ownerId,
      code_hash: hashToken(code),
      client_id: parsed.clientId,
      redirect_uri: parsed.redirectUri,
      code_challenge: parsed.codeChallenge,
      scope: parsed.scope,
      resource: parsed.resource,
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    if (error) throw new Error("Could not create authorization code.");
    const redirect = new URL(parsed.redirectUri);
    redirect.searchParams.set("code", code);
    if (parsed.state) redirect.searchParams.set("state", parsed.state);
    redirect.searchParams.set("iss", parsed.origin);
    return NextResponse.redirect(redirect);
  } catch (error) {
    return new NextResponse(error instanceof Error ? error.message : "Authorization failed.", { status: 400 });
  }
}
