import type { ConnectorDefinition } from "./types";

export const googleGmailConnector: ConnectorDefinition = {
  id: "gmail",
  displayName: "Gmail and Google Workspace",
  source: "email",
  channelKind: "email",
  authorization: "oauth2-web-server",
  accountAudience: "work-school-and-personal",
  availability: "available",
  description: "Private Gmail and Google Workspace mailboxes with separate account identities.",
  setupNote: "Connected securely through Google OAuth.",
  scopes: ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.modify"],
  capabilities: {
    validateConnection: true,
    fullSync: true,
    incrementalSync: true,
    pushNotifications: false,
    createDraft: false,
    sendWithApproval: false,
    archive: true,
    trash: true,
    permanentDelete: false,
    markRead: true,
    unsubscribe: false,
  },
};
