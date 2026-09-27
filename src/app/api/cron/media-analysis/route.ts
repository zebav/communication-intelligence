import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { processEmailMediaJob } from "@/lib/media/email-worker";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const database = createAdminClient();
  const { data: jobs, error } = await database.from("vault_ingestion_jobs")
    .select("id,owner_id,connection_id,provider,provider_message_id,source_message_id,source_conversation_id,source_person_id,attempts,metadata")
    .eq("state", "pending").in("provider", ["microsoft-graph", "gmail"]).order("created_at", { ascending: true }).limit(3);
  if (error) return NextResponse.json({ error: "Media queue could not be read." }, { status: 500 });
  const results = await Promise.allSettled((jobs ?? []).map((job) => processEmailMediaJob(database, job)));
  return NextResponse.json({ processed: results.filter((result) => result.status === "fulfilled" && result.value.processed).length, failed: results.filter((result) => result.status === "rejected").length, scanned: jobs?.length ?? 0 });
}
