import { describe, expect, it } from "vitest";
import { verifyMailboxSyncResult } from "./mailbox-sync-result";

describe("verifyMailboxSyncResult", () => {
  const attemptedAt = Date.parse("2026-10-10T13:40:00.000Z");

  it("accepts a fresh completed sync", () => {
    expect(verifyMailboxSyncResult(true, { imported: 4, syncedAt: "2026-10-10T13:39:59.000Z" }, attemptedAt, "gmail"))
      .toMatchObject({ ok: true, imported: 4, skipped: false });
  });

  it("rejects a successful-looking response without fresh sync evidence", () => {
    expect(verifyMailboxSyncResult(true, { imported: 0, syncedAt: "2026-10-10T13:20:00.000Z" }, attemptedAt, "microsoft-graph"))
      .toMatchObject({ ok: false, errorCode: "outlook_sync_stale" });
  });

  it("retains a safe provider error code", () => {
    expect(verifyMailboxSyncResult(false, { code: "gmail_reconnect_required" }, attemptedAt, "gmail"))
      .toMatchObject({ ok: false, errorCode: "gmail_reconnect_required" });
  });
});
