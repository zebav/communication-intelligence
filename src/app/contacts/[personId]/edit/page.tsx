import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ContactProfileEditor } from "@/components/contact-profile-editor";

export const dynamic = "force-dynamic";

export default async function EditContactPage({ params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) redirect("/login");
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") redirect("/auth/mfa");
  const { data: person } = await database.from("people").select("id,display_name,organization,relationship_type,entity_type,professional_specialty,jurisdiction,notes,relationship_summary,manual_priority,overall_priority").eq("id", personId).eq("owner_id", user.id).maybeSingle();
  if (!person) notFound();
  return <main className="page contact-edit-page"><ContactProfileEditor person={person} screen /></main>;
}
