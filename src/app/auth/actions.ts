"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error?: string } | undefined;
export type MfaState = { error?: string } | undefined;

const loginSchema = z.object({
  email: z.email().trim(),
  password: z.string().min(8),
});

export async function login(_: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) return { error: "Enter a valid email and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "The email or password is incorrect." };

  // A password sign-in is only AAL1. Go straight to the required MFA step
  // instead of loading the protected home page just to be redirected again.
  redirect("/auth/mfa");
}

export async function verifyMfa(_: MfaState, formData: FormData): Promise<MfaState> {
  const factorId = String(formData.get("factorId") ?? "");
  const code = String(formData.get("code") ?? "");
  if (!factorId || !/^\d{6}$/.test(code)) return { error: "Enter the six-digit code from your authenticator app." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
  if (factorsError || !factors?.totp.some((factor) => factor.id === factorId)) {
    return { error: "The authenticator could not be verified. Sign in again." };
  }

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
  if (challengeError || !challenge) return { error: "The verification challenge could not be started. Try again." };

  const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
  if (verifyError) return { error: "The six-digit code is incorrect or has expired." };

  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
