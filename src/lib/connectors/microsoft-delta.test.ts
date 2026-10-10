import { describe, expect, it } from "vitest";
import { initialInboxDeltaUrl, shouldRestartExpiredInboxCursor, validatedInboxDeltaUrl } from "./microsoft-delta";

describe("Microsoft inbox delta URLs", () => {
  it("loads bounded newest-first pages from the last year for relationship history", () => {
    const url = initialInboxDeltaUrl(Date.parse("2026-09-02T12:00:00Z"));
    expect(url.searchParams.get("$top")).toBe("25");
    expect(url.searchParams.get("$filter")).toContain("2025-09-02T12:00:00.000Z");
    expect(url.searchParams.get("$select")).toContain("uniqueBody");
  });

  it("accepts Microsoft Graph cursors and rejects other hosts", () => {
    const valid = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=safe";
    expect(validatedInboxDeltaUrl(valid).toString()).toBe(valid);
    const graphVariant = "https://graph.microsoft.com/v1.0/me/mailFolders('inbox')/messages/delta?$deltatoken=safe";
    expect(validatedInboxDeltaUrl(graphVariant).toString()).toBe(graphVariant);
    const graphFolderCursor = "https://graph.microsoft.com/v1.0/me/mailFolders('AQMkADNkNAAAgEMAAAA')/messages/delta?$skiptoken=safe";
    expect(validatedInboxDeltaUrl(graphFolderCursor).toString()).toBe(graphFolderCursor);
    expect(() => validatedInboxDeltaUrl("https://example.com/collect")).toThrow("invalid_delta_link");
    expect(() => validatedInboxDeltaUrl("https://graph.microsoft.com/v1.0/me/messages/delta?$deltatoken=unsafe")).toThrow("invalid_delta_link");
  });

  it("restarts a stored inbox cursor once when Graph expires it", () => {
    expect(shouldRestartExpiredInboxCursor({ status: 410, usingStoredCursor: true, alreadyRestarted: false })).toBe(true);
    expect(shouldRestartExpiredInboxCursor({ status: 410, usingStoredCursor: true, alreadyRestarted: true })).toBe(false);
    expect(shouldRestartExpiredInboxCursor({ status: 410, usingStoredCursor: false, alreadyRestarted: false })).toBe(false);
  });
});
