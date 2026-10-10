export type MailboxSyncPayload = {
  code?: unknown;
  imported?: unknown;
  skipped?: unknown;
  syncedAt?: unknown;
};

export type VerifiedMailboxSync = {
  ok: boolean;
  errorCode?: string;
  imported: number;
  skipped: boolean;
  syncedAt?: string;
};

/**
 * A 200 response from a connector is not enough evidence that a mailbox is
 * current.  Connector routes may intentionally skip a request that is very
 * close to a completed sync.  That is healthy only when the returned sync
 * timestamp is recent; otherwise the durable worker must retry instead of
 * reporting a stale mailbox as complete.
 */
export function verifyMailboxSyncResult(
  responseOk: boolean,
  payload: MailboxSyncPayload | null,
  attemptedAt: number,
  provider: "gmail" | "microsoft-graph",
): VerifiedMailboxSync {
  const fallback = provider === "gmail" ? "gmail_sync_failed" : "outlook_sync_failed";
  const payloadCode = typeof payload?.code === "string"
    && new RegExp(`^${provider === "gmail" ? "gmail" : "outlook"}_[a-z0-9_]+$`).test(payload.code)
    ? payload.code
    : undefined;
  if (!responseOk) return { ok: false, errorCode: payloadCode ?? fallback, imported: 0, skipped: false };

  const imported = typeof payload?.imported === "number" && Number.isFinite(payload.imported)
    ? Math.max(0, Math.trunc(payload.imported))
    : 0;
  const skipped = payload?.skipped === true;
  const syncedAt = typeof payload?.syncedAt === "string" && !Number.isNaN(Date.parse(payload.syncedAt))
    ? payload.syncedAt
    : undefined;
  // Allow the connector's five-minute coalescing window plus clock/network
  // variance.  Anything older proves this worker did not refresh the source.
  const stale = !syncedAt || Date.parse(syncedAt) < attemptedAt - (6 * 60 * 1000);
  if (stale) {
    return {
      ok: false,
      errorCode: provider === "gmail" ? "gmail_sync_stale" : "outlook_sync_stale",
      imported,
      skipped,
      syncedAt,
    };
  }
  return { ok: true, imported, skipped, syncedAt };
}
