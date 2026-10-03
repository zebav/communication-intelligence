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
  return runEmailIntelligence(new NextRequest(url, request));
}
