import { after, NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// The workspace must remain quick even when a mailbox has a large backlog.
// This authenticated endpoint acknowledges the login immediately, then starts
// the bounded maintenance run after the response has been sent.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) return NextResponse.json({ error: "Din session har gått ut." }, { status: 401 });
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.json({ error: "Tvåstegsverifiering krävs." }, { status: 403 });
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Ogiltigt ursprung." }, { status: 403 });

  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return NextResponse.json({ queued: false, reason: "automation_not_configured" }, { status: 202 });

  const ownerId = user.id;
  const maintenanceUrl = new URL("/api/cron/outlook-intelligence", request.url);
  after(async () => {
    await fetch(maintenanceUrl, {
      headers: {
        authorization: `Bearer ${cronSecret}`,
        "x-owner-id": ownerId,
        "x-maintenance-trigger": "login",
      },
      signal: AbortSignal.timeout(55_000),
    }).catch(() => undefined);
  });

  return NextResponse.json({ queued: true }, { headers: { "Cache-Control": "no-store" } });
}
