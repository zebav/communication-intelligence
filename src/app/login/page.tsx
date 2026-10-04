import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "@/components/login-form";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/");

  return <AuthShell>
    <div className="auth-heading">
      <h1>Välkommen tillbaka</h1>
      <p>Din privata AI-arbetsyta för kommunikation, relationer och vardagsbeslut.</p>
    </div>
    <LoginForm />
    <p className="auth-security-note"><ShieldCheck size={15} aria-hidden="true" />Tvåfaktorsautentisering skyddar din arbetsyta.</p>
  </AuthShell>;
}
