import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { MfaGate } from "@/components/mfa-gate";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function MfaPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <AuthShell mode="mfa"><MfaGate /></AuthShell>;
}
