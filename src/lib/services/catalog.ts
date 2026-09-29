import type { ChannelConnection } from "@/lib/domain";

export type ServicePermission = "off" | "read" | "suggest" | "prepare";
export type ServiceId =
  | "gmail" | "outlook" | "instagram" | "whatsapp" | "google_calendar"
  | "outlook_calendar" | "google_maps" | "google_drive" | "onedrive"
  | "browserbase" | "slack";

export type ServiceDefinition = {
  id: ServiceId;
  name: string;
  category: "Messages" | "Planning" | "Documents" | "Web";
  purpose: string;
  maxPermission: ServicePermission;
  capabilities: readonly string[];
  providerIds?: readonly string[];
  environment?: readonly string[];
  available: boolean;
  setupNote?: string;
};

export const serviceCatalog: readonly ServiceDefinition[] = [
  { id: "gmail", name: "Gmail", category: "Messages", purpose: "Imports email and prepares approved replies.", maxPermission: "prepare", capabilities: ["Read messages", "Suggest replies", "Prepare approved send"], providerIds: ["gmail"], available: true },
  { id: "outlook", name: "Outlook", category: "Messages", purpose: "Imports Microsoft mail and prepares approved replies.", maxPermission: "prepare", capabilities: ["Read messages", "Suggest replies", "Prepare approved send"], providerIds: ["microsoft-graph"], available: true },
  { id: "instagram", name: "Instagram", category: "Messages", purpose: "Collects professional direct messages and proposes replies.", maxPermission: "prepare", capabilities: ["Read messages", "Suggest replies", "Prepare approved send"], providerIds: ["instagram", "instagram-professional"], available: true },
  { id: "whatsapp", name: "WhatsApp", category: "Messages", purpose: "Brings business conversations into the shared inbox.", maxPermission: "prepare", capabilities: ["Read messages", "Suggest replies", "Prepare approved send"], providerIds: ["whatsapp", "whatsapp-business", "ycloud"], available: true },
  { id: "slack", name: "Slack", category: "Messages", purpose: "Collects selected direct messages and channels into the shared inbox.", maxPermission: "read", capabilities: ["Read selected messages", "Suggest a follow-up"], providerIds: ["slack"], environment: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"], available: true, setupNote: "The pilot is read-only. Choose exactly what Slack may read after connecting." },
  { id: "google_calendar", name: "Google Calendar", category: "Planning", purpose: "Provides availability to the master calendar and creates approved bookings.", maxPermission: "prepare", capabilities: ["Read availability", "Suggest times", "Prepare approved booking"], providerIds: ["google-calendar"], available: true },
  { id: "outlook_calendar", name: "Outlook Calendar", category: "Planning", purpose: "Provides Microsoft availability to the master calendar.", maxPermission: "prepare", capabilities: ["Read availability", "Suggest times", "Prepare approved booking"], providerIds: ["microsoft-calendar"], available: true },
  { id: "google_maps", name: "Google Maps", category: "Planning", purpose: "Finds places and estimates travel time for meeting plans.", maxPermission: "suggest", capabilities: ["Find places", "Estimate travel", "Show map"], environment: ["GOOGLE_MAPS_API_KEY"], available: true },
  { id: "google_drive", name: "Google Drive", category: "Documents", purpose: "Uses only documents you actively select for context and analysis.", maxPermission: "read", capabilities: ["Read selected files", "Analyse documents"], providerIds: ["google-drive"], available: true },
  { id: "onedrive", name: "OneDrive", category: "Documents", purpose: "Uses only documents you actively select for context and analysis.", maxPermission: "read", capabilities: ["Read selected files", "Analyse documents"], providerIds: ["microsoft-onedrive"], available: true },
  { id: "browserbase", name: "Browserbase", category: "Web", purpose: "Carries out standard web tasks only after an exact task and final approval.", maxPermission: "prepare", capabilities: ["Open approved site", "Prepare web task", "Run standard approved task"], environment: ["BROWSERBASE_API_KEY"], available: true },
] as const;

export const serviceById = (id: string) => serviceCatalog.find((service) => service.id === id);

const rank: Record<ServicePermission, number> = { off: 0, read: 1, suggest: 2, prepare: 3 };
export const servicePermissionAtMost = (value: ServicePermission, ceiling: ServicePermission) => rank[value] <= rank[ceiling];

type StoredPolicy = { service_id: string; permission: ServicePermission; enabled: boolean; updated_at: string | null };
export type ServiceSnapshot = ServiceDefinition & {
  status: "connected" | "ready" | "needs_setup" | "planned" | "paused";
  accountLabel: string | null;
  lastSyncAt: string | null;
  policy: ServicePermission;
  policyUpdatedAt: string | null;
};

export function serviceSnapshots(input: { connections: ChannelConnection[]; policies: StoredPolicy[]; environment?: NodeJS.ProcessEnv }): ServiceSnapshot[] {
  return serviceCatalog.map((service) => {
    const connection = input.connections.find((item) => service.providerIds?.includes(item.provider) && item.status === "connected");
    const policy = input.policies.find((item) => item.service_id === service.id);
    const configured = !service.environment?.length || service.environment.every((key) => Boolean(input.environment?.[key]?.trim()));
    const enabled = policy?.enabled ?? true;
    const status: ServiceSnapshot["status"] = !enabled ? "paused" : connection ? "connected" : !service.available ? "planned" : service.environment?.length && configured ? "ready" : "needs_setup";
    return {
      ...service,
      status: connection ? (enabled ? "connected" : "paused") : status,
      accountLabel: connection?.accountName ?? connection?.accountIdentifier ?? null,
      lastSyncAt: connection?.lastSyncAt ?? null,
      policy: policy?.permission ?? service.maxPermission,
      policyUpdatedAt: policy?.updated_at ?? null,
    };
  });
}
