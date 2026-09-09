import type { ConnectorCapabilities, ConnectorDefinition } from "./types";
import { microsoftGraphConnector } from "./microsoft-graph";

const capabilities = (enabled: Partial<ConnectorCapabilities> = {}): ConnectorCapabilities => ({
  validateConnection: false, fullSync: false, incrementalSync: false, pushNotifications: false,
  createDraft: false, sendWithApproval: false, archive: false, trash: false,
  permanentDelete: false, markRead: false, unsubscribe: false, ...enabled,
});

export const connectorCatalog: readonly ConnectorDefinition[] = [
  microsoftGraphConnector,
  { id: "instagram-professional", displayName: "Instagram Professional", source: "instagram", channelKind: "direct-message", authorization: "oauth2-web-server", accountAudience: "professional-account", availability: "planned", description: "Direct messages for eligible professional accounts.", setupNote: "Meta application and messaging permission required.", scopes: [], capabilities: capabilities({ validateConnection: true, incrementalSync: true, pushNotifications: true, sendWithApproval: true }) },
  { id: "messenger-page", displayName: "Messenger", source: "messenger", channelKind: "direct-message", authorization: "oauth2-web-server", accountAudience: "page", availability: "planned", description: "Messages handled through an eligible Facebook Page.", setupNote: "Meta Page connection and review required.", scopes: [], capabilities: capabilities({ validateConnection: true, incrementalSync: true, pushNotifications: true, sendWithApproval: true }) },
  { id: "whatsapp-business", displayName: "WhatsApp Business", source: "whatsapp", channelKind: "chat", authorization: "webhook", accountAudience: "business-account", availability: "planned", description: "Business conversations through the official WhatsApp platform.", setupNote: "Business phone number and webhook setup required.", scopes: [], capabilities: capabilities({ validateConnection: true, incrementalSync: true, pushNotifications: true, sendWithApproval: true }) },
  { id: "manual-capture", displayName: "Manual capture", source: "manual", channelKind: "manual", authorization: "manual", accountAudience: "personal-manual", availability: "available", description: "Owner-provided conversations from sources without an approved API.", setupNote: "No external account access required.", scopes: [], capabilities: capabilities({ validateConnection: true, fullSync: true }) },
  { id: "tinder-manual", displayName: "Tinder", source: "tinder", channelKind: "direct-message", authorization: "manual", accountAudience: "personal-manual", availability: "planned", description: "Manual capture only until a safe, approved integration is available.", setupNote: "No account automation is enabled.", scopes: [], capabilities: capabilities() },
] as const;

export function connectorById(id: string) { return connectorCatalog.find((connector) => connector.id === id); }
export function connectorsForSource(source: ConnectorDefinition["source"]) { return connectorCatalog.filter((connector) => connector.source === source); }
