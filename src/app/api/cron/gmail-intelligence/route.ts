import { NextRequest } from "next/server";
import { GET as runEmailIntelligence } from "../outlook-intelligence/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Gmail has a dedicated Vercel Cron endpoint so its import capacity and
 * failures are isolated from Microsoft/Outlook. The shared implementation is
 * intentionally kept in one place to ensure identical priority analysis.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  url.searchParams.set("provider", "gmail");
  // Preserve the signed cron and owner-maintenance headers explicitly. Passing
  // a NextRequest as the second constructor argument relies on RequestInit
  // shape compatibility and can drop owner scoping on a wrapper route. That
  // makes an otherwise successful queued Gmail run do no work for the owner
  // who triggered it, while still returning 200 to the dispatcher.
  return runEmailIntelligence(new NextRequest(url, {
    method: request.method,
    headers: request.headers,
  }));
}
