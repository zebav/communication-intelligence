import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readDataIngestionHealth } from "@/lib/data-ingestion-health";

export async function GET() {
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) return NextResponse.json({ error: "Din session har gått ut." }, { status: 401 });
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.json({ error: "Tvåstegsverifiering krävs." }, { status: 403 });
  try { return NextResponse.json(await readDataIngestionHealth(database, user.id)); }
  catch { return NextResponse.json({ error: "Datainhämtningens status kunde inte läsas." }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) return NextResponse.json({ error: "Din session har gått ut." }, { status: 401 });
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.json({ error: "Tvåstegsverifiering krävs." }, { status: 403 });
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Ogiltigt ursprung." }, { status: 403 });
  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  if (body?.action !== "retry_failed_media") return NextResponse.json({ error: "Okänd återställning." }, { status: 400 });
  // Terminal jobs get one explicit owner retry. Automatic retries never reset
  // this counter, so a persistent provider failure cannot become an endless
  // background loop.
  const admin = createAdminClient();
  const { data: candidates, error: lookupError } = await admin.from("vault_ingestion_jobs")
    .select("id").eq("owner_id", user.id).eq("state", "dead_letter").eq("manual_retry_count", 0).order("updated_at", { ascending: true }).limit(10);
  if (lookupError) return NextResponse.json({ error: "Misslyckade bilagor kunde inte läsas." }, { status: 500 });
  const ids = (candidates ?? []).map((job) => job.id);
  if (!ids.length) return NextResponse.json({ ok: true, retried: 0 });
  const { error } = await admin.from("vault_ingestion_jobs")
    .update({ state: "pending", attempts: 0, manual_retry_count: 1, last_error_code: null, failed_stage: null, error_details: {}, next_retry_at: null, dead_lettered_at: null, updated_at: new Date().toISOString() })
    .in("id", ids).eq("owner_id", user.id).eq("state", "dead_letter").eq("manual_retry_count", 0);
  if (error) return NextResponse.json({ error: "Misslyckade bilagor kunde inte läggas tillbaka i kön." }, { status: 500 });
  return NextResponse.json({ ok: true, retried: ids.length });
}
