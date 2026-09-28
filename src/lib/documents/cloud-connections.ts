export const documentCloudProviders = ["google-drive", "microsoft-onedrive"] as const;
export type DocumentCloudProvider = typeof documentCloudProviders[number];

export const googleDriveScopes = ["openid", "email", "profile", "https://www.googleapis.com/auth/drive.file"] as const;
export const microsoftOneDriveScopes = ["openid", "profile", "offline_access", "User.Read", "Files.Read"] as const;

export const documentCloudCapabilities = {
  validateConnection: true,
  fullSync: false,
  incrementalSync: false,
  pushNotifications: false,
  createDraft: false,
  sendWithApproval: false,
  archive: false,
  trash: false,
  permanentDelete: false,
  markRead: false,
  unsubscribe: false,
} as const;

export const documentCloudLabels: Record<DocumentCloudProvider, string> = {
  "google-drive": "Google Drive",
  "microsoft-onedrive": "OneDrive",
};
