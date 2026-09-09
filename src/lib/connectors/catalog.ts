import type { ConnectorCapabilities, ConnectorDefinition } from "./types";
import { microsoftGraphConnector } from "./microsoft-graph";

const capabilities = (enabled: Partial<ConnectorCapabilities> = {}): ConnectorCapabilities => ({
  validateConnection: false, fullSync: false, incrementalSync: false, pushNotifications: false,
  createDraft: false, sendWithApproval: false, archive: false, trash: false,
  permanentDelete: false, markRead: false, unsubscribe: false, ...enabled,
});

export const connectorCatalog: readonly ConnectorDefinition[] = [
  microsoftGraphConnector,
  { id: "gmail", displayName: "Gmail", source: "email", channelKind: "email", authorization: "oauth2-web-server", accountAudience: "work-school-and-personal", availability: "planned", description: "One or more private or Google Workspace mailboxes.", setupNote: "Google OAuth connection is planned; manual import is available now.", scopes: [], capabilities: capabilities({ validateConnection: true, incrementalSync: true, pushNotifications: true, createDraft: true, sendWithApproval: true }) },
  { id: "imessage-manual", displayName: "iMessage", source: "imessage", channelKind: "chat", authorization: "manual", accountAudience: "personal-manual", availability: "available", description: "Owner-provided iMessage conversation exports.", setupNote: "Import pasted text or an exported file; no Apple account access is requested.", scopes: [], capabilities: capabilities({ validateConnection: true, fullSync: true }) },
  { id: "instagram-professional", displayName: "Instagram Professional", source: "instagram", channelKind: "direct-message", authorization: "oauth2-web-server", accountAudience: "professional-account", availability: "planned", description: "Direct messages for eligible professional accounts.", setupNote: "Meta application and messaging permission required.", scopes: [], capabilities: capabilities({ validateConnection: true, incrementalSync: true, pushNotifications: true, sendWithApproval: true }) },
  { id: "messenger-page", displayName: "Messenger", source: "messenger", channelKind: "direct-message", authorization: "oauth2-web-server", accountAudience: "page", availability: "planned", description: "Messages handled through an eligible Facebook Page.", setupNote: "Meta Page connection and review required.", scopes: [], capabilities: capabilities({ validateConnection: true, incrementalSync: true, pushNotifications: true, sendWithApproval: true }) },
  { id: "whatsapp-business", displayName: "WhatsApp Business", source: "whatsapp", channelKind: "chat", authorization: "webhook", accountAudience: "business-account", availability: "planned", description: "Business conversations through the official WhatsApp platform.", setupNote: "Business phone number and webhook setup required.", scopes: [], capabilities: capabilities({ validateConnection: true, incrementalSync: true, pushNotifications: true, sendWithApproval: true }) },
  { id: "manual-capture", displayName: "Manual capture", source: "manual", channelKind: "manual", authorization: "manual", accountAudience: "personal-manual", availability: "available", description: "Owner-provided conversations from sources without an approved API.", setupNote: "No external account access required.", scopes: [], capabilities: capabilities({ validateConnection: true, fullSync: true }) },
  { id: "linkedin-manual", displayName: "LinkedIn", source: "linkedin", channelKind: "direct-message", authorization: "manual", accountAudience: "personal-manual", availability: "available", description: "Owner-provided LinkedIn conversation exports.", setupNote: "Manual import is available; direct account access is not enabled.", scopes: [], capabilities: capabilities({ fullSync: true }) },
  { id: "tiktok-manual", displayName: "TikTok", source: "tiktok", channelKind: "direct-message", authorization: "manual", accountAudience: "personal-manual", availability: "available", description: "Owner-provided TikTok conversations.", setupNote: "Manual import is available; direct account access is not enabled.", scopes: [], capabilities: capabilities({ fullSync: true }) },
  { id: "tinder-manual", displayName: "Tinder", source: "tinder", channelKind: "direct-message", authorization: "manual", accountAudience: "personal-manual", availability: "available", description: "Owner-provided Tinder conversations.", setupNote: "Manual import only. No account automation is enabled.", scopes: [], capabilities: capabilities({ fullSync: true }) },
] as const;

export function connectorById(id: string) { return connectorCatalog.find((connector) => connector.id === id); }
export function connectorsForSource(source: ConnectorDefinition["source"]) { return connectorCatalog.filter((connector) => connector.source === source); }
