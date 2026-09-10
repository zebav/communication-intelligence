"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const guidanceSchema = z.object({ tone: z.string().trim().max(2000), guidance: z.string().trim().max(20000) });
const profileSchema = z.object({ identitySummary: z.string().trim().max(20000), values: z.string().trim().max(20000), defaultTone: z.string().trim().max(2000), preferredLength: z.string().trim().max(1000), principles: z.string().trim().max(20000), signOff: z.string().trim().max(1000), channels: z.record(z.string(), guidanceSchema), situations: z.record(z.string(), guidanceSchema), people: z.record(z.string().uuid(), guidanceSchema.extend({ name: z.string().trim().max(500) })) });

export async function saveUniversalCommunicationProfile(input: z.infer<typeof profileSchema>) {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) { const field = parsed.error.issues[0]?.path.join(".") || "profile"; return { error: `The field "${field}" contains too much text or an invalid value. Please check that field and try again.` }; }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return { error: "Two-factor authentication is required." };
  const personIds = Object.keys(parsed.data.people);
  if (personIds.length) {
    const { data: ownedPeople } = await supabase.from("people").select("id").eq("owner_id", user.id).in("id", personIds);
    if ((ownedPeople ?? []).length !== personIds.length) return { error: "One selected person is not available in your workspace." };
  }
  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin.from("profiles").select("preferences").eq("id", user.id).maybeSingle();
  if (profileError || !profile) return { error: "Your profile record could not be found. Nothing was saved." };
  const preferences = profile.preferences && typeof profile.preferences === "object" && !Array.isArray(profile.preferences) ? profile.preferences : {};
  const { data: savedProfile, error } = await admin.from("profiles").update({ preferences: { ...preferences, universal_communication_profile: parsed.data }, updated_at: new Date().toISOString() }).eq("id", user.id).select("preferences").maybeSingle();
  if (error || !savedProfile) return { error: "The universal communication profile could not be saved. No profile record was updated." };
  const storedPreferences = savedProfile.preferences && typeof savedProfile.preferences === "object" && !Array.isArray(savedProfile.preferences) ? savedProfile.preferences as { universal_communication_profile?: unknown } : {};
  const verified = profileSchema.safeParse(storedPreferences.universal_communication_profile);
  if (!verified.success || JSON.stringify(verified.data) !== JSON.stringify(parsed.data)) {
    return { error: "The database did not confirm the complete profile. Nothing has been marked as saved." };
  }
  revalidatePath("/");
  return { success: true, profile: verified.data };
}
