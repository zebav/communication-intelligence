import { redirect } from "next/navigation";
import { ManualMcpTokenManager } from "@/components/manual-mcp-token-manager";
import { configuredMcpOwnerId } from "@/lib/manual-mcp-tokens";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function McpIntegrationSettingsPage() {
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) redirect("/login?next=/settings/integrations/mcp");
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") redirect("/auth/mfa?next=/settings/integrations/mcp");
  if (!configuredMcpOwnerId() || user.id !== configuredMcpOwnerId()) redirect("/");
  return <ManualMcpTokenManager />;
}
