import { redirect } from "next/navigation";
import { ChannelDiagnostics } from "@/components/channel-diagnostics";
import { createClient } from "@/lib/supabase/server";
import { whatsappConnector } from "@/lib/connectors/whatsapp";

export const dynamic = "force-dynamic";

type SocialSource = "instagram" | "whatsapp";

type SocialPersistence = {
  source: SocialSource;
  identities: number;
  conversations: number;
  messages: number;
  latestMessageAt: string | null;
};

export default async function ChannelDiagnosticsPage() {
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) redirect("/login");
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") redirect("/auth/mfa");

  const { data: connections } = await database
    .from("connections")
    .select("id,account_name,account_identifier")
    .eq("owner_id", user.id)
    .eq("provider", whatsappConnector.id)
    .eq("status", "connected")
    .order("updated_at", { ascending: false });

  const whatsappConnections = (connections ?? []).map((connection) => ({
    id: connection.id,
    label: connection.account_name || connection.account_identifier || "WhatsApp Business",
  }));

  const persistence = await Promise.all((["instagram", "whatsapp"] as const).map(async (source): Promise<SocialPersistence> => {
    const [{ count: identities }, { count: conversations }, { count: messages }, { data: latest }] = await Promise.all([
      database.from("identities").select("id", { count: "exact", head: true }).eq("owner_id", user.id).eq("source", source),
      database.from("conversations").select("id", { count: "exact", head: true }).eq("owner_id", user.id).eq("source", source),
      database.from("messages").select("id", { count: "exact", head: true }).eq("owner_id", user.id).eq("source", source),
      database.from("messages").select("sent_at").eq("owner_id", user.id).eq("source", source).order("sent_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    return { source, identities: identities ?? 0, conversations: conversations ?? 0, messages: messages ?? 0, latestMessageAt: latest?.sent_at ?? null };
  }));

  return <ChannelDiagnostics whatsappConnections={whatsappConnections} persistence={persistence} />;
}
