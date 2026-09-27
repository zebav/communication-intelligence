import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { processPendingEmailMediaJobs } from "@/lib/media/email-worker";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const database = createAdminClient();
  try {
    return NextResponse.json(await processPendingEmailMediaJobs(database, 3));
  } catch {
    return NextResponse.json({ error: "Media queue could not be read." }, { status: 500 });
  }
}
