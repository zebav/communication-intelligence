import { NextResponse } from "next/server";
import { communicationProfileSchema } from "@/lib/communication-profile-schema";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function authenticatedOwner() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return assurance?.currentLevel === "aal2" ? { user, supabase } : null;
}

export async function GET() {
  const session = await authenticatedOwner();
  if (!session) return NextResponse.json({ error: "Your session has expired or MFA is required." }, { status: 401 });
  const { data: rows, error } = await session.supabase.rpc("get_universal_communication_profile");
  const data = Array.isArray(rows) ? rows[0] : rows;
  if (error || !data) return NextResponse.json({ error: "Your profile record could not be loaded." }, { status: 500 });
  const preferences = data.preferences && typeof data.preferences === "object" && !Array.isArray(data.preferences) ? data.preferences as { universal_communication_profile?: unknown } : {};
  const parsed = communicationProfileSchema.safeParse(preferences.universal_communication_profile);
  return NextResponse.json({ profile: parsed.success ? parsed.data : null, updatedAt: data.updated_at }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await authenticatedOwner();
  if (!session) return NextResponse.json({ error: "Your session has expired or MFA is required." }, { status: 401 });
  const parsed = communicationProfileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join(".") || "profile";
    return NextResponse.json({ error: `The field "${field}" contains too much text or an invalid value.` }, { status: 400 });
  }
  const { data: rows, error: updateError } = await session.supabase.rpc("save_universal_communication_profile", { profile_data: parsed.data });
  if (updateError) return NextResponse.json({ error: `Supabase rejected the profile update (${updateError.code}).` }, { status: 500 });
  const confirmed = Array.isArray(rows) ? rows[0] : rows;
  const confirmedPreferences = confirmed?.preferences && typeof confirmed.preferences === "object" && !Array.isArray(confirmed.preferences) ? confirmed.preferences as { universal_communication_profile?: unknown } : {};
  const verified = communicationProfileSchema.safeParse(confirmedPreferences.universal_communication_profile);
  if (!verified.success || JSON.stringify(verified.data) !== JSON.stringify(parsed.data)) {
    return NextResponse.json({ error: "Supabase did not confirm the complete profile. Nothing has been marked as saved." }, { status: 500 });
  }
  return NextResponse.json({
    success: true,
    profile: verified.data,
    updatedAt: confirmed?.updated_at,
    verifiedCharacters: verified.data.identitySummary.length + verified.data.values.length + verified.data.principles.length,
  }, { headers: { "Cache-Control": "no-store" } });
}
