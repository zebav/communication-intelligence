import type { ConnectorDefinition } from "./types";

export const whatsappConnector: ConnectorDefinition = {
  id: "whatsapp-business",
  displayName: "WhatsApp Business",
  source: "whatsapp",
  channelKind: "chat",
  authorization: "api-token",
  accountAudience: "business-account",
  availability: "available",
  description: "WhatsApp Business conversations through the official Meta Cloud API.",
  setupNote: "Requires a WhatsApp Business phone number and Meta Cloud API credentials.",
  scopes: ["whatsapp_business_messaging", "whatsapp_business_management"],
  capabilities: {
    validateConnection: true,
    fullSync: false,
    incrementalSync: true,
    pushNotifications: true,
    createDraft: true,
    sendWithApproval: true,
    archive: false,
    trash: false,
    permanentDelete: false,
    markRead: true,
    unsubscribe: false,
  },
};
