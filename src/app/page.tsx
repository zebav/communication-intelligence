import { redirect } from "next/navigation";
import { Workspace } from "@/components/workspace";
import { createClient } from "@/lib/supabase/server";
import type { CommunicationCase, Source } from "@/lib/domain";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!assurance || assurance.currentLevel !== "aal2") redirect("/auth/mfa");

  const { data: rows } = await supabase
    .from("conversations")
    .select("id,title,source,created_at,people(display_name),messages(body_text,sent_at)")
    .order("created_at", { ascending: false })
    .limit(50);

  const communicationCases: CommunicationCase[] = (rows ?? []).map((row) => {
    const person = Array.isArray(row.people) ? row.people[0] : row.people;
    const messages = Array.isArray(row.messages) ? row.messages : [];
    const latestMessage = [...messages].sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))[0];
    return { id: row.id, personName: person?.display_name ?? "Unknown person", title: row.title ?? "Untitled communication", source: row.source as Source, message: latestMessage?.body_text ?? "", createdAt: row.created_at };
  });

  return <Workspace userEmail={user.email ?? "Private owner"} communicationCases={communicationCases} />;
}
