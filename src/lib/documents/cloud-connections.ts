export const documentCloudProviders = ["google-drive", "microsoft-onedrive", "google-photos"] as const;
export type DocumentCloudProvider = typeof documentCloudProviders[number];

export const googleDriveScopes = ["openid", "email", "profile", "https://www.googleapis.com/auth/drive.file"] as const;
/** The Photos Picker scope only exposes media explicitly selected in Google's picker. */
export const googlePhotosPickerScopes = ["openid", "email", "profile", "https://www.googleapis.com/auth/photospicker.mediaitems.readonly"] as const;
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
  "google-photos": "Google Foto",
};
