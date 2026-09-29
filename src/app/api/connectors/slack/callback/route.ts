import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { encryptCredential } from "@/lib/connectors/credential-crypto";
import { slackConfig, slackReadOnlyScopes } from "@/lib/connectors/slack-oauth";
import { createClient } from "@/lib/supabase/server";

type SlackTokenResponse = {
  ok?: boolean;
  access_token?: string;
  token_type?: string;
  scope?: string;
  team?: { id?: string; name?: string };
  authed_user?: { id?: string };
};

function sameState(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function resultRedirect(request: NextRequest, result: "connected" | "denied" | "invalid" | "failed") {
  return NextResponse.redirect(new URL(`/?view=settings&settings=services&service=slack&slack=${result}`, request.url));
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("error")) return resultRedirect(request, "denied");
  const code = request.nextUrl.searchParams.get("code"); const state = request.nextUrl.searchParams.get("state");
  const jar = await cookies(); const expectedState = jar.get("slack_oauth_state")?.value; const verifier = jar.get("slack_oauth_verifier")?.value;
  jar.delete("slack_oauth_state"); jar.delete("slack_oauth_verifier");
  if (!code || !state || !expectedState || !verifier || !sameState(state, expectedState)) return resultRedirect(request, "invalid");

  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const { data: assurance } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.redirect(new URL("/auth/mfa", request.url));

  try {
    const config = slackConfig(request.nextUrl.origin);
    const response = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: config.redirectUri, code_verifier: verifier }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return resultRedirect(request, "failed");
    const token = await response.json() as SlackTokenResponse;
    if (!token.ok || !token.access_token || !token.team?.id) return resultRedirect(request, "failed");
    const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
    if (!encryptionKey) return resultRedirect(request, "failed");
    const accountIdentifier = token.team.id;
    const { data: existing } = await db.from("connections").select("id").eq("owner_id", user.id).eq("provider", "slack").eq("account_identifier", accountIdentifier).maybeSingle();
    const values = {
      owner_id: user.id, provider: "slack", source: "manual", account_name: token.team.name ?? "Slack workspace", account_identifier: accountIdentifier,
      status: "connected", health_status: "healthy", capabilities: { validateConnection: true, fullSync: false, incrementalSync: false, pushNotifications: false, createDraft: true, sendWithApproval: false },
      scopes: token.scope?.split(",").filter(Boolean) ?? [...slackReadOnlyScopes],
      encrypted_credentials: encryptCredential({ accessToken: token.access_token, tokenType: token.token_type, slackUserId: token.authed_user?.id, workspaceId: token.team.id }, encryptionKey),
      token_metadata: { workspace_id: token.team.id, workspace_name: token.team.name ?? null, pilot: "read_only" }, updated_at: new Date().toISOString(),
    };
    const saved = existing?.id ? await db.from("connections").update(values).eq("id", existing.id).eq("owner_id", user.id) : await db.from("connections").insert(values);
    return saved.error ? resultRedirect(request, "failed") : resultRedirect(request, "connected");
  } catch {
    return resultRedirect(request, "failed");
  }
}
