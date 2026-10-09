import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { MfaGate } from "@/components/mfa-gate";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const FACTOR_LOOKUP_TIMEOUT_MS = 7_000;

export default async function MfaPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // The browser-side client can still be hydrating its auth cookie immediately
  // after a password sign-in. Read factors from the server-side session instead:
  // it is both the authoritative session and avoids a second client auth request
  // delaying the MFA prompt.
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel === "aal2") redirect("/");

  // A transient auth-provider delay must never leave someone on a blank MFA
  // screen for the provider's full request timeout. We keep MFA enforced and
  // offer a safe retry instead.
  const factorResult = await Promise.race([
    supabase.auth.mfa.listFactors(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), FACTOR_LOOKUP_TIMEOUT_MS)),
  ]);
  const factors = factorResult?.data;
  const factorsError = factorResult?.error ?? (factorResult ? null : new Error("MFA factor lookup timed out"));
  const verifiedFactor = factors?.totp.find((factor) => factor.status === "verified");

  return <AuthShell mode="mfa"><MfaGate
    verifiedFactorId={verifiedFactor?.id}
    enrollmentRequired={!factorsError && !verifiedFactor}
    loadError={factorsError ? "Din autentiseringsapp kunde inte hämtas just nu. Försök igen utan att logga ut." : undefined}
  /></AuthShell>;
}
