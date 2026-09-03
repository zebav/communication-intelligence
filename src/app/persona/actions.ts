"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const guidanceSchema = z.object({ tone: z.string().trim().max(160), guidance: z.string().trim().max(600) });
const profileSchema = z.object({ identitySummary: z.string().trim().max(1000), values: z.string().trim().max(600), defaultTone: z.string().trim().max(160), preferredLength: z.string().trim().max(80), principles: z.string().trim().max(1000), signOff: z.string().trim().max(120), channels: z.record(z.string(), guidanceSchema), situations: z.record(z.string(), guidanceSchema), people: z.record(z.string().uuid(), guidanceSchema.extend({ name: z.string().trim().max(200) })) });

export async function saveUniversalCommunicationProfile(input: z.infer<typeof profileSchema>) {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the profile fields and try again." };
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
  const { data: profile } = await supabase.from("profiles").select("preferences").eq("id", user.id).maybeSingle();
  const preferences = profile?.preferences && typeof profile.preferences === "object" && !Array.isArray(profile.preferences) ? profile.preferences : {};
  const { error } = await supabase.from("profiles").update({ preferences: { ...preferences, universal_communication_profile: parsed.data }, updated_at: new Date().toISOString() }).eq("id", user.id);
  if (error) return { error: "The universal communication profile could not be saved." };
  revalidatePath("/");
  return { success: true };
}
