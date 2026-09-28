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
  // Requeue only the owner's failed imports. The processor still claims each
  // item atomically and applies all file, size and media-safety controls.
  const { error } = await createAdminClient().from("vault_ingestion_jobs")
    .update({ state: "pending", last_error_code: null, updated_at: new Date().toISOString() })
    .eq("owner_id", user.id).eq("state", "failed");
  if (error) return NextResponse.json({ error: "Misslyckade bilagor kunde inte läggas tillbaka i kön." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
