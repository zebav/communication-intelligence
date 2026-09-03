const GRAPH_HOST = "graph.microsoft.com";
const INBOX_DELTA_PATH = "/v1.0/me/mailFolders/inbox/messages/delta";

export function initialInboxDeltaUrl(now = Date.now()) {
  const url = new URL(`https://${GRAPH_HOST}${INBOX_DELTA_PATH}`);
  url.searchParams.set("$top", "25");
  url.searchParams.set("$orderby", "receivedDateTime desc");
  url.searchParams.set("$filter", `receivedDateTime ge ${new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()}`);
  url.searchParams.set("$select", "id,conversationId,internetMessageId,subject,bodyPreview,from,receivedDateTime,sentDateTime,importance,inferenceClassification,isRead,hasAttachments");
  return url;
}

export function validatedInboxDeltaUrl(value: unknown) {
  if (typeof value !== "string") return initialInboxDeltaUrl();
  const url = new URL(value);
  const inboxDeltaPath = /^\/v1\.0\/me\/mailFolders(?:\/inbox|\(['"]inbox['"]\))\/messages\/delta$/i;
  if (url.protocol !== "https:" || url.hostname !== GRAPH_HOST || !inboxDeltaPath.test(decodeURIComponent(url.pathname))) {
    throw new Error("invalid_delta_link");
  }
  return url;
}
