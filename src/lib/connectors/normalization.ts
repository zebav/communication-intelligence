import type { ConnectorDefinition, NormalizedCommunicationMessage } from "./types";

type ProviderMessage = {
  externalId: string;
  externalConversationId?: string;
  direction: "in" | "out";
  senderIdentifier?: string;
  senderName?: string;
  subject?: string;
  body?: string;
  sentAt?: string;
  attachmentCount?: number;
  metadata?: Record<string, unknown>;
};

export function normalizeCommunicationMessage(connector: ConnectorDefinition, message: ProviderMessage): NormalizedCommunicationMessage {
  if (!message.externalId.trim()) throw new Error("external_message_id_required");
  const body = message.body?.trim() ?? "";
  return {
    externalId: message.externalId,
    externalConversationId: message.externalConversationId?.trim() || message.externalId,
    source: connector.source,
    channelKind: connector.channelKind,
    direction: message.direction,
    senderIdentifier: message.senderIdentifier?.trim().toLowerCase(),
    senderName: message.senderName?.trim(),
    subject: message.subject?.trim(),
    body,
    sentAt: message.sentAt && !Number.isNaN(Date.parse(message.sentAt)) ? new Date(message.sentAt).toISOString() : new Date(0).toISOString(),
    attachmentCount: Math.max(0, Math.floor(message.attachmentCount ?? 0)),
    providerMetadata: { provider: connector.id, channel_kind: connector.channelKind, ...(message.metadata ?? {}) },
  };
}
