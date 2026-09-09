import type { Source } from "@/lib/domain";

export type ConnectorCapability =
  | "validateConnection"
  | "fullSync"
  | "incrementalSync"
  | "pushNotifications"
  | "createDraft"
  | "sendWithApproval"
  | "archive"
  | "trash"
  | "permanentDelete"
  | "markRead"
  | "unsubscribe";

export type ConnectorCapabilities = Record<ConnectorCapability, boolean>;

export type ChannelKind = "email" | "direct-message" | "chat" | "manual";
export type ConnectorAvailability = "connected" | "available" | "planned";
export type ConnectorAuthorization = "oauth2-web-server" | "api-token" | "webhook" | "manual";
export type ConnectorAudience = "work-school-and-personal" | "professional-account" | "business-account" | "page" | "personal-manual";

export interface ConnectorDefinition {
  id: string;
  displayName: string;
  source: Source;
  channelKind: ChannelKind;
  authorization: ConnectorAuthorization;
  accountAudience: ConnectorAudience;
  availability: ConnectorAvailability;
  description: string;
  setupNote: string;
  scopes: readonly string[];
  capabilities: ConnectorCapabilities;
}

export interface NormalizedCommunicationMessage {
  externalId: string;
  externalConversationId: string;
  source: Source;
  channelKind: ChannelKind;
  direction: "in" | "out";
  senderIdentifier?: string;
  senderName?: string;
  subject?: string;
  body: string;
  sentAt: string;
  attachmentCount: number;
  providerMetadata: Record<string, unknown>;
}
