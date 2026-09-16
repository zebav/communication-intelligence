import { describe, expect, it, vi } from "vitest";
import { CalendarSyncResetRequired, GoogleCalendarReader, normalizeGoogleEvent } from "./google-calendar";
describe("Google calendar normalization and sync", () => {
  it("retains all-day local dates and exclusive end across DST", () => {
    const e = normalizeGoogleEvent({ id: "a", start: { date: "2026-10-25" }, end: { date: "2026-10-26" } }, "master", "Europe/Stockholm");
    expect(e).toMatchObject({ allDay: true, start: "2026-10-25", end: "2026-10-26", timezone: "Europe/Stockholm" });
  });
  it("accepts cancelled tombstones without inventing a date", () => {
    expect(normalizeGoogleEvent({ id: "x", status: "cancelled" }, "m", "UTC")).toEqual({ id: "x", calendarId: "m", status: "cancelled" });
  });
  it("does not block declined invitations", () => {
    expect(normalizeGoogleEvent({ id: "x", start: { dateTime: "2026-10-01T10:00:00Z" }, end: { dateTime: "2026-10-01T11:00:00Z" }, attendees: [{ self: true, responseStatus: "declined" }] }, "m", "UTC")).toMatchObject({ blocksAvailability: false });
  });
  it("consumes every page before advancing sync token", async () => {
    const transport = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ timeZone: "UTC", items: [], nextPageToken: "p2" }))).mockResolvedValueOnce(new Response(JSON.stringify({ timeZone: "UTC", items: [{ id: "x", status: "cancelled" }], nextSyncToken: "next" })));
    const result = await new GoogleCalendarReader("test", transport).syncChanges("m", "old");
    expect(result.nextCursor).toBe("next"); expect(result.events).toHaveLength(1);
    expect(transport.mock.calls[1][0]).toContain("pageToken=p2");
    expect(transport.mock.calls[1][0]).not.toContain("timeMin");
  });
  it("fails safely on stale tokens", async () => {
    const reader = new GoogleCalendarReader("test", vi.fn().mockResolvedValue(new Response("", { status: 410 })));
    await expect(reader.syncChanges("m", "old")).rejects.toBeInstanceOf(CalendarSyncResetRequired);
  });
});
