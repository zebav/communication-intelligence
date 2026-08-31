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

export interface ConnectorDefinition {
  id: string;
  displayName: string;
  source: "email";
  authorization: "oauth2-web-server";
  scopes: readonly string[];
  capabilities: ConnectorCapabilities;
}
