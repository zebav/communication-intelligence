import { describe, expect, it } from "vitest";
import { connectionSyncIssueLabel, safeConnectionSyncIssue } from "./sync-status";

describe("safeConnectionSyncIssue", () => {
  it("maps only allow-listed connector diagnostics to product states", () => {
    expect(safeConnectionSyncIssue("outlook_reconnect_required")).toBe("reconnect");
    expect(safeConnectionSyncIssue("outlook_sync_failed")).toBe("temporary");
    expect(safeConnectionSyncIssue("outlook_delta_cursor_invalid")).toBe("recovery");
    expect(safeConnectionSyncIssue("provider response with a private URL")).toBe("unknown");
    expect(safeConnectionSyncIssue(undefined)).toBeUndefined();
  });

  it("keeps user-facing text concise and free from provider details", () => {
    expect(connectionSyncIssueLabel("temporary")).toMatch(/försöker igen automatiskt/i);
    expect(connectionSyncIssueLabel("reconnect")).toBe("Återanslutning krävs");
  });
});
