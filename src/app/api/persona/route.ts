import { NextResponse } from "next/server";
import { communicationProfileSchema } from "@/lib/communication-profile-schema";
import { createAdminClient } from "@/lib/supabase/admin";
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
  const { data, error } = await session.supabase.from("profiles").select("preferences,updated_at").eq("id", session.user.id).maybeSingle();
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
  const admin = createAdminClient();
  const { data: existing, error: readError } = await session.supabase.from("profiles").select("preferences").eq("id", session.user.id).maybeSingle();
  if (readError) return NextResponse.json({ error: `Your profile could not be read (${readError.code}).` }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Your authenticated account has no profile record." }, { status: 500 });
  const preferences = existing.preferences && typeof existing.preferences === "object" && !Array.isArray(existing.preferences) ? existing.preferences : {};
  const updatedAt = new Date().toISOString();
  const { error: updateError } = await admin.from("profiles").update({ preferences: { ...preferences, universal_communication_profile: parsed.data }, updated_at: updatedAt }).eq("id", session.user.id);
  if (updateError) return NextResponse.json({ error: `Supabase rejected the profile update (${updateError.code}).` }, { status: 500 });
  const { data: confirmed, error: confirmError } = await session.supabase.from("profiles").select("preferences,updated_at").eq("id", session.user.id).maybeSingle();
  const confirmedPreferences = confirmed?.preferences && typeof confirmed.preferences === "object" && !Array.isArray(confirmed.preferences) ? confirmed.preferences as { universal_communication_profile?: unknown } : {};
  const verified = communicationProfileSchema.safeParse(confirmedPreferences.universal_communication_profile);
  if (confirmError || !verified.success || JSON.stringify(verified.data) !== JSON.stringify(parsed.data)) {
    return NextResponse.json({ error: "Supabase did not confirm the complete profile. Nothing has been marked as saved." }, { status: 500 });
  }
  return NextResponse.json({
    success: true,
    profile: verified.data,
    updatedAt: confirmed?.updated_at,
    verifiedCharacters: verified.data.identitySummary.length + verified.data.values.length + verified.data.principles.length,
  }, { headers: { "Cache-Control": "no-store" } });
}
