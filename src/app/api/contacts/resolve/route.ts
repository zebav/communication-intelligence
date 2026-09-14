import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name")?.trim();
  if (!name) return NextResponse.json({ error: "Missing contact name." }, { status: 400 });

  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.json({ error: "MFA required." }, { status: 403 });

  const { data, error } = await database
    .from("people")
    .select("id,display_name,last_contact_at")
    .eq("owner_id", user.id)
    .ilike("display_name", name)
    .order("last_contact_at", { ascending: false, nullsFirst: false })
    .limit(3);
  if (error) return NextResponse.json({ error: "Contact lookup failed." }, { status: 500 });
  const exact = (data ?? []).find((person) => person.display_name?.localeCompare(name, undefined, { sensitivity: "accent" }) === 0) ?? data?.[0];
  if (!exact) return NextResponse.json({ error: "No matching contact." }, { status: 404 });
  return NextResponse.json({ personId: exact.id });
}
