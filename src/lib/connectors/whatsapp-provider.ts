import type { NormalizedCommunicationMessage } from "./types";

export type WhatsAppProviderId = "ycloud" | "meta-direct";

export type WhatsAppProviderMessage = {
  businessAccountId: string;
  phoneNumberId: string;
  displayPhoneNumber?: string;
  participantId: string;
  participantName?: string;
  message: NormalizedCommunicationMessage;
};

export type WhatsAppProviderStatus = {
  phoneNumberId: string;
  externalMessageId: string;
  status: string;
  timestamp?: string;
  recipientId?: string;
  errors?: unknown;
};

export type WhatsAppProviderEvents = {
  provider: WhatsAppProviderId;
  messages: WhatsAppProviderMessage[];
  statuses: WhatsAppProviderStatus[];
};

export type WhatsAppProviderCapabilities = {
  receivesMessages: boolean;
  receivesMobileReplies: boolean;
  receivesStatuses: boolean;
  sendsMessages: boolean;
};

export interface WhatsAppProviderAdapter<Context = undefined> {
  readonly id: WhatsAppProviderId;
  readonly capabilities: WhatsAppProviderCapabilities;
  verifyWebhook(rawBody: string, signature: string | null, secret: string, now?: number): boolean;
  parseWebhook(rawBody: string, context: Context): WhatsAppProviderEvents;
}

export function activeWhatsAppProvider(environment?: { WHATSAPP_ACTIVE_PROVIDER?: string; YCLOUD_WEBHOOK_SECRET?: string }): WhatsAppProviderId {
  const resolvedEnvironment = environment ?? (process.env as unknown as {
    WHATSAPP_ACTIVE_PROVIDER?: string;
    YCLOUD_WEBHOOK_SECRET?: string;
  });
  const configured = resolvedEnvironment.WHATSAPP_ACTIVE_PROVIDER?.trim().toLowerCase();
  if (configured === "ycloud" || configured === "meta-direct") return configured;
  return resolvedEnvironment.YCLOUD_WEBHOOK_SECRET?.trim() ? "ycloud" : "meta-direct";
}

export function inactiveProviderResponse(provider: WhatsAppProviderId, activeProvider: WhatsAppProviderId) {
  return { received: true, ignored: true, provider, activeProvider, reason: "inactive_provider" };
}
