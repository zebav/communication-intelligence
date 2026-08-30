import { redirect } from "next/navigation";
import { Bolt } from "lucide-react";
import { MfaGate } from "@/components/mfa-gate";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function MfaPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <main className="auth-page"><section className="auth-card mfa-card"><div className="auth-brand"><span className="brand-mark"><Bolt size={15} /></span><span>Communication Intelligence</span></div><MfaGate /><small>MFA is enforced in both the application and database access policies.</small></section></main>;
}
