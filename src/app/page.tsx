import { redirect } from "next/navigation";
import { Workspace } from "@/components/workspace";
import { createClient } from "@/lib/supabase/server";
import type { CommunicationCase, Source, SyncedEmailConversation } from "@/lib/domain";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!assurance || assurance.currentLevel !== "aal2") redirect("/auth/mfa");

  const { data: rows } = await supabase
    .from("conversations")
    .select("id,title,source,created_at,priority_score,recommended_action,people(display_name),messages(id,body_text,sent_at,classification,importance_score,metadata)")
    .order("created_at", { ascending: false })
    .limit(50);

  const { data: microsoftConnection } = await supabase
    .from("connections")
    .select("account_name,account_identifier,status,health_status,last_sync_at")
    .eq("owner_id", user.id)
    .eq("provider", "microsoft-graph")
    .eq("status", "connected")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const communicationCases: CommunicationCase[] = (rows ?? []).filter((row) => row.source !== "email").map((row) => {
    const person = Array.isArray(row.people) ? row.people[0] : row.people;
    const messages = Array.isArray(row.messages) ? row.messages : [];
    const latestMessage = [...messages].sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))[0];
    return { id: row.id, personName: person?.display_name ?? "Unknown person", title: row.title ?? "Untitled communication", source: row.source as Source, message: latestMessage?.body_text ?? "", createdAt: row.created_at };
  });

  const syncedEmails: SyncedEmailConversation[] = (rows ?? []).filter((row) => row.source === "email").map((row) => {
    const person = Array.isArray(row.people) ? row.people[0] : row.people;
    const messages = Array.isArray(row.messages) ? row.messages : [];
    const latestMessage = [...messages].sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))[0];
    const recommendation = row.recommended_action && typeof row.recommended_action === "object" && !Array.isArray(row.recommended_action)
      ? (row.recommended_action as { action?: string }).action
      : undefined;
    const metadata = latestMessage?.metadata && typeof latestMessage.metadata === "object" && !Array.isArray(latestMessage.metadata)
      ? latestMessage.metadata as { is_read?: boolean; ai_analysis?: SyncedEmailConversation["analysis"] }
      : {};
    return {
      id: row.id,
      messageId: latestMessage?.id ?? "",
      personName: person?.display_name ?? "Unknown sender",
      title: row.title ?? "(No subject)",
      preview: latestMessage?.body_text ?? "",
      receivedAt: latestMessage?.sent_at ?? row.created_at,
      classification: latestMessage?.classification ?? "Information Only",
      priorityScore: Number(row.priority_score ?? latestMessage?.importance_score ?? 0),
      recommendedAction: recommendation ?? "RESPOND_LATER",
      unread: metadata.is_read === false,
      analysis: metadata.ai_analysis,
    };
  });

  return <Workspace
    userEmail={user.email ?? "Private owner"}
    communicationCases={communicationCases}
    microsoftConnection={microsoftConnection}
    syncedEmails={syncedEmails}
  />;
}
