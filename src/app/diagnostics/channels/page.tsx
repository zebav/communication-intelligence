import { redirect } from "next/navigation";
import { ChannelDiagnostics } from "@/components/channel-diagnostics";
import { createClient } from "@/lib/supabase/server";
import { whatsappConnector } from "@/lib/connectors/whatsapp";

export const dynamic = "force-dynamic";

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

  return <ChannelDiagnostics whatsappConnections={whatsappConnections} />;
}
