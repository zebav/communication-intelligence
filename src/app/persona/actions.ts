"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const personaSchema = z.object({ identitySummary: z.string().trim().max(600), defaultTone: z.string().trim().max(160), preferredLength: z.string().trim().max(80), principles: z.string().trim().max(600), signOff: z.string().trim().max(120) });

export async function saveCommunicationPersona(input: z.infer<typeof personaSchema>) {
  const parsed = personaSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the persona fields and try again." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return { error: "Two-factor authentication is required." };
  const { data: profile } = await supabase.from("profiles").select("preferences").eq("id", user.id).maybeSingle();
  const preferences = profile?.preferences && typeof profile.preferences === "object" && !Array.isArray(profile.preferences) ? profile.preferences : {};
  const { error } = await supabase.from("profiles").update({ preferences: { ...preferences, communication_persona: parsed.data }, updated_at: new Date().toISOString() }).eq("id", user.id);
  if (error) return { error: "The communication persona could not be saved." };
  revalidatePath("/");
  return { success: true };
}
