import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SentMessages } from "@/components/sent-messages";
import { BackToWorkspaceButton } from "@/components/back-to-workspace-button";
export default async function SentPage() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: aal } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") redirect("/auth/mfa");
  const { data, error } = await db.from("connections").select("id,account_identifier,account_name").eq("owner_id", user.id).abortSignal(AbortSignal.timeout(8000));
  return <main className="page"><BackToWorkspaceButton />{error && <p role="alert">Kontofiltret kunde inte laddas.</p>}<SentMessages accounts={(data ?? []).map(a => ({ id: a.id, name: a.account_identifier ?? a.account_name ?? "Namnlöst konto" }))} /></main>;
}
