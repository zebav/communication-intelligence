import type { ConnectorDefinition } from "./types";

export const gmailConnector: ConnectorDefinition = {
  id: "gmail",
  displayName: "Gmail",
  source: "email",
  authorization: "oauth2-web-server",
  scopes: [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
  ],
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
