import type { ConnectorDefinition } from "./types";

export const microsoftGraphConnector: ConnectorDefinition = {
  id: "microsoft-graph",
  displayName: "Outlook and Microsoft 365",
  source: "email",
  authorization: "oauth2-web-server",
  accountAudience: "work-school-and-personal",
  scopes: ["openid", "profile", "offline_access", "User.Read", "Mail.ReadWrite", "Mail.Send"],
  capabilities: {
    validateConnection: true,
    fullSync: true,
    incrementalSync: true,
    pushNotifications: true,
    createDraft: true,
    sendWithApproval: true,
    archive: true,
    trash: true,
    permanentDelete: false,
    markRead: true,
    unsubscribe: false,
  },
};
