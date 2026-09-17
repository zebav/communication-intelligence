import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createRestrictedBrowserSession } from "@/lib/browser/browserbase";
import {
  browserRiskSchema,
  buildBrowserDomainPolicy,
  mayExecuteBrowserAction,
} from "@/lib/browser/domain-policy";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  targetUrl: z.string().url(),
  additionalUrls: z.array(z.string().url()).max(8).default([]),
  risk: browserRiskSchema.default("medium"),
  approved: z.boolean().default(false),
  taskId: z.string().max(160).optional(),
});

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return jsonError("Invalid request origin.", 403);
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid browser action request.");

  const database = await createClient();
  const {
    data: { user },
  } = await database.auth.getUser();
  if (!user) return jsonError("Your session has expired. Sign in again.", 401);

  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") {
    return jsonError("Two-factor authentication is required.", 403);
  }

  const urls = [parsed.data.targetUrl, ...parsed.data.additionalUrls];
  const policy = buildBrowserDomainPolicy(urls);
  if (!policy) return jsonError("All browser targets must be public HTTPS URLs.", 422);

  if (
    !mayExecuteBrowserAction({
      risk: parsed.data.risk,
      approved: parsed.data.approved,
      targetUrl: parsed.data.targetUrl,
      exactHosts: policy.exactHosts,
    })
  ) {
    const message =
      parsed.data.risk === "critical"
        ? "Critical browser actions cannot be executed automatically."
        : "This browser action requires explicit approval or targets a disallowed host.";
    return jsonError(message, 403);
  }

  try {
    const session = await createRestrictedBrowserSession({
      policy,
      metadata: {
        ownerId: user.id,
        taskId: parsed.data.taskId ?? null,
        risk: parsed.data.risk,
      },
    });

    await database.from("audit_logs").insert({
      owner_id: user.id,
      actor_id: user.id,
      actor_type: "user",
      action: "browser.session_created",
      object_type: "browser_session",
      object_id: parsed.data.taskId ?? session.id,
      source: "browser",
      new_value: {
        session_id: session.id,
        risk: parsed.data.risk,
        approved: parsed.data.approved,
        allowed_hosts: policy.exactHosts,
      },
    });

    return NextResponse.json({
      sessionId: session.id,
      status: session.status,
      expiresAt: session.expiresAt ?? null,
      allowedHosts: policy.exactHosts,
    });
  } catch (error) {
    console.error("Browser session creation failed", error);
    return jsonError("The restricted browser session could not be created.", 502);
  }
}
