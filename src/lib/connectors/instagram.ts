import type { ConnectorDefinition } from "./types";

export const instagramConnector: ConnectorDefinition = {
  id: "instagram-professional",
  displayName: "Instagram Professional",
  source: "instagram",
  channelKind: "direct-message",
  authorization: "oauth2-web-server",
  accountAudience: "professional-account",
  availability: "available",
  description: "Instagram direct messages for eligible professional accounts.",
  setupNote: "Requires an Instagram professional account and an approved Meta app.",
  scopes: ["instagram_business_basic", "instagram_business_manage_messages"],
  capabilities: {
    validateConnection: true,
    fullSync: false,
    incrementalSync: false,
    pushNotifications: false,
    createDraft: false,
    sendWithApproval: true,
    archive: false,
    trash: false,
    permanentDelete: false,
    markRead: false,
    unsubscribe: false,
  },
};
