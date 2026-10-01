import type { ChannelConnection } from "@/lib/domain";

export type ServicePermission = "off" | "read" | "suggest" | "prepare";
export type ServiceId =
  | "gmail" | "outlook" | "instagram" | "whatsapp" | "google_calendar"
  | "outlook_calendar" | "google_maps" | "google_drive" | "onedrive"
  | "browserbase" | "slack" | "google_photos";

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
  { id: "slack", name: "Slack", category: "Messages", purpose: "Collects selected direct messages and channels into the shared inbox.", maxPermission: "suggest", capabilities: ["Read selected messages", "Suggest replies", "Suggest a follow-up"], providerIds: ["slack"], environment: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"], available: true, setupNote: "Synkar läsbehöriga direktmeddelanden och öppna kanaler. Utkast skapas i Solvani; inget skickas till Slack utan en separat framtida skrivbehörighet." },
  { id: "google_calendar", name: "Google Calendar", category: "Planning", purpose: "Provides availability to the master calendar and creates approved bookings.", maxPermission: "prepare", capabilities: ["Read availability", "Suggest times", "Prepare approved booking"], providerIds: ["google-calendar"], available: true },
  { id: "outlook_calendar", name: "Outlook Calendar", category: "Planning", purpose: "Provides Microsoft availability to the master calendar.", maxPermission: "prepare", capabilities: ["Read availability", "Suggest times", "Prepare approved booking"], providerIds: ["microsoft-calendar"], available: true },
  { id: "google_maps", name: "Google Maps", category: "Planning", purpose: "Finds places, estimates travel time and checks weather for meeting plans.", maxPermission: "suggest", capabilities: ["Find places", "Estimate travel", "Check weather", "Show map"], environment: ["CALENDAR_MAPS_ENABLED", "CALENDAR_BROWSER_MAPS_ENABLED", "GOOGLE_MAPS_SERVER_API_KEY", "GOOGLE_MAPS_BROWSER_API_KEY"], available: true },
  { id: "google_drive", name: "Google Drive", category: "Documents", purpose: "Uses only documents you actively select for context and analysis.", maxPermission: "read", capabilities: ["Read selected files", "Analyse documents"], providerIds: ["google-drive"], available: true },
  { id: "google_photos", name: "Google Foto", category: "Documents", purpose: "Imports only photos you explicitly choose for personal context or contact media.", maxPermission: "read", capabilities: ["Choose photos", "Analyse images", "Use as contact image"], providerIds: ["google-photos"], available: true, setupNote: "Du väljer alltid bilder i Googles egen bildväljare. Solvani skannar aldrig hela ditt fotobibliotek." },
  { id: "onedrive", name: "OneDrive", category: "Documents", purpose: "Uses only documents you actively select for context and analysis.", maxPermission: "read", capabilities: ["Read selected files", "Analyse documents"], providerIds: ["microsoft-onedrive"], available: true },
  { id: "browserbase", name: "Browserbase", category: "Web", purpose: "Carries out standard web tasks only after an exact task and final approval.", maxPermission: "prepare", capabilities: ["Open approved site", "Prepare web task", "Run standard approved task"], environment: ["BROWSERBASE_API_KEY"], available: true },
] as const;

export const serviceById = (id: string) => serviceCatalog.find((service) => service.id === id);

const rank: Record<ServicePermission, number> = { off: 0, read: 1, suggest: 2, prepare: 3 };
export const servicePermissionAtMost = (value: ServicePermission, ceiling: ServicePermission) => rank[value] <= rank[ceiling];

type StoredPolicy = { service_id: string; permission: ServicePermission; enabled: boolean; updated_at: string | null };
type CalendarAccount = { provider: "google" | "microsoft"; address: string; lastSyncAt?: string | null };
export type ServiceSnapshot = ServiceDefinition & {
  status: "connected" | "ready" | "needs_setup" | "planned" | "paused";
  accountLabel: string | null;
  lastSyncAt: string | null;
  policy: ServicePermission;
  policyUpdatedAt: string | null;
};

export function serviceSnapshots(input: { connections: ChannelConnection[]; calendars?: CalendarAccount[]; policies: StoredPolicy[]; environment?: NodeJS.ProcessEnv }): ServiceSnapshot[] {
  return serviceCatalog.map((service) => {
    const connection = input.connections.find((item) => service.providerIds?.includes(item.provider) && item.status === "connected");
    const calendarProvider = service.id === "google_calendar" ? "google" : service.id === "outlook_calendar" ? "microsoft" : null;
    const calendar = calendarProvider ? input.calendars?.find((item) => item.provider === calendarProvider) : undefined;
    const policy = input.policies.find((item) => item.service_id === service.id);
    const mapsKeyConfigured = Boolean(input.environment?.GOOGLE_MAPS_SERVER_API_KEY?.trim());
    const configured = service.id === "google_maps"
      ? input.environment?.CALENDAR_MAPS_ENABLED === "true" && input.environment?.CALENDAR_BROWSER_MAPS_ENABLED === "true" && mapsKeyConfigured && Boolean(input.environment?.GOOGLE_MAPS_BROWSER_API_KEY?.trim())
      : !service.environment?.length || service.environment.every((key) => Boolean(input.environment?.[key]?.trim()));
    const enabled = policy?.enabled ?? true;
    const isConnected = Boolean(connection || calendar || (service.id === "google_maps" && configured));
    const status: ServiceSnapshot["status"] = !enabled ? "paused" : isConnected ? "connected" : service.id === "google_maps" && mapsKeyConfigured ? "ready" : !service.available ? "planned" : service.environment?.length && configured ? "ready" : "needs_setup";
    return {
      ...service,
      status,
      accountLabel: connection?.accountName ?? connection?.accountIdentifier ?? calendar?.address ?? (service.id === "google_maps" && mapsKeyConfigured ? (configured ? "Plats, resor, väder och karta" : "API-nyckel finns · aktivering saknas") : null),
      lastSyncAt: connection?.lastSyncAt ?? calendar?.lastSyncAt ?? null,
      policy: policy?.permission ?? service.maxPermission,
      policyUpdatedAt: policy?.updated_at ?? null,
    };
  });
}
