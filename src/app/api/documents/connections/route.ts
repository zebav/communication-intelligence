import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { documentCloudLabels, documentCloudProviders, type DocumentCloudProvider } from "@/lib/documents/cloud-connections";

export async function GET() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Logga in för att se dokumentanslutningar." }, { status: 401 });
  const { data: assurance } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.json({ error: "MFA krävs." }, { status: 403 });
  const { data, error } = await db.from("connections").select("id,provider,account_name,account_identifier,status,health_status,updated_at")
    .eq("owner_id", user.id).in("provider", [...documentCloudProviders]).order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Dokumentanslutningarna kunde inte läsas." }, { status: 500 });
  return NextResponse.json({ connections: (data ?? []).map(connection => ({
    id: connection.id, provider: connection.provider as DocumentCloudProvider,
    label: documentCloudLabels[connection.provider as DocumentCloudProvider] ?? connection.provider,
    account: connection.account_name ?? connection.account_identifier ?? "Anslutet konto",
    status: connection.status, health: connection.health_status, updatedAt: connection.updated_at,
  })) });
}
