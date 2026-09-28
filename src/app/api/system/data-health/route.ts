import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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
