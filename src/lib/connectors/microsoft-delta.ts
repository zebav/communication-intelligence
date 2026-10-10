const GRAPH_HOST = "graph.microsoft.com";
const INBOX_DELTA_PATH = "/v1.0/me/mailFolders/inbox/messages/delta";

export function initialInboxDeltaUrl(now = Date.now()) {
  const url = new URL(`https://${GRAPH_HOST}${INBOX_DELTA_PATH}`);
  // Keep the first recovery page comfortably inside a serverless run. The
  // opaque nextLink continues the same delta round on later passes, so this
  // trades a timeout-prone bulk import for reliable resumable progress.
  url.searchParams.set("$top", "25");
  url.searchParams.set("$orderby", "receivedDateTime desc");
  url.searchParams.set("$filter", `receivedDateTime ge ${new Date(now - 365 * 24 * 60 * 60 * 1000).toISOString()}`);
  url.searchParams.set("$select", "id,conversationId,internetMessageId,subject,body,uniqueBody,bodyPreview,from,receivedDateTime,sentDateTime,importance,inferenceClassification,isRead,hasAttachments");
  return url;
}

export function validatedInboxDeltaUrl(value: unknown) {
  if (typeof value !== "string") return initialInboxDeltaUrl();
  const url = new URL(value);
  // Microsoft turns the friendly `inbox` segment into the opaque folder id in
  // its own nextLink/deltaLink values. The cursor still has to remain on the
  // signed-in user's mail-folder delta endpoint at Graph; accepting only the
  // literal word `inbox` caused every resumed Outlook sync to be rejected.
  const inboxDeltaPath = /^\/v1\.0\/me\/mailFolders(?:\/inbox|\(['"](?:inbox|[A-Za-z0-9._~+\/=\-]+)['"]\))\/messages\/delta$/i;
  if (url.protocol !== "https:" || url.hostname !== GRAPH_HOST || !inboxDeltaPath.test(decodeURIComponent(url.pathname))) {
    throw new Error("invalid_delta_link");
  }
  return url;
}

/** A Graph delta cursor can expire independently of OAuth credentials. */
export function shouldRestartExpiredInboxCursor(input: { status: number; usingStoredCursor: boolean; alreadyRestarted: boolean }) {
  return input.status === 410 && input.usingStoredCursor && !input.alreadyRestarted;
}
