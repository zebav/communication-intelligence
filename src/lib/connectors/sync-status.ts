/**
 * A deliberately small translation layer between connector workers and the
 * product UI. Provider errors often include URLs, identifiers, or request
 * details, so only these allow-listed diagnostic codes may cross that line.
 */
export type ConnectionSyncIssue = "reconnect" | "temporary" | "recovery" | "unknown";

export function safeConnectionSyncIssue(value: unknown): ConnectionSyncIssue | undefined {
  if (typeof value !== "string") return undefined;

  switch (value) {
    case "outlook_reconnect_required":
    case "outlook_access_denied":
    case "gmail_reconnect_required":
      return "reconnect";
    case "outlook_provider_temporary":
    case "outlook_sync_failed":
    case "outlook_worker_unavailable":
    case "gmail_sync_failed":
      return "temporary";
    case "outlook_delta_cursor_invalid":
    case "outlook_cursor_save_failed":
    case "outlook_credential_update_failed":
    case "outlook_identity_lookup_failed":
    case "outlook_identity_save_failed":
    case "outlook_person_save_failed":
    case "outlook_conversation_save_failed":
    case "outlook_message_save_failed":
    case "gmail_cursor_save_failed":
      return "recovery";
    default:
      return "unknown";
  }
}

export function connectionSyncIssueLabel(issue: ConnectionSyncIssue | undefined) {
  switch (issue) {
    case "reconnect":
      return "Återanslutning krävs";
    case "temporary":
      return "Senaste synkningen avbröts – Solvani försöker igen automatiskt";
    case "recovery":
      return "Solvani återställer synkningen automatiskt";
    case "unknown":
      return "Solvani kontrollerar synkningen automatiskt";
    default:
      return undefined;
  }
}
