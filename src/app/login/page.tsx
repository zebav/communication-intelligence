import { redirect } from "next/navigation";
import { Bolt, ShieldCheck } from "lucide-react";
import { LoginForm } from "@/components/login-form";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/");

  return <main className="auth-page">
    <section className="auth-card">
      <div className="auth-brand"><span className="brand-mark"><Bolt size={15} /></span><span>Communication Intelligence</span></div>
      <div className="auth-icon"><ShieldCheck size={22} /></div>
      <span className="eyebrow">Private workspace</span>
      <h1>Welcome back</h1>
      <p>Your communication command center is protected. Sign in with your manually provisioned account.</p>
      <LoginForm />
      <small>Public registration is disabled. MFA is required after sign-in.</small>
    </section>
  </main>;
}
