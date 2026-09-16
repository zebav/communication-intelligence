import { describe, it, expect } from "vitest";
import { suggestSlots } from "./scheduling";
import type { CalendarEvent } from "./types";
const input = {
  windows: [{ start: "2026-10-01T10:00:00+02:00", end: "2026-10-01T14:00:00+02:00" }],
  events: [] as CalendarEvent[], holds: [], physical: false, reconciled: true, syncFresh: true,
  now: "2026-09-15T10:00:00Z",
  preferences: { durationMinutes: 60, preparationMinutes: 15, recoveryMinutes: 15, stepMinutes: 15, timezone: "Europe/Stockholm" },
};
describe("master scheduling", () => {
  it("validates an exact typed time without rounding to the suggestion grid",()=>{
    expect(suggestSlots({...input,requestedStart:"2026-10-01T09:17:00Z"}).map(s=>s.start)).toEqual(["2026-10-01T09:17:00.000Z"]);
    expect(suggestSlots({...input,requestedStart:"2026-10-01T07:59:00Z"})).toEqual([]);
  });
  it("preserves offsets and fits distinct buffers inside the window", () => {
    const result = suggestSlots(input);
    expect(result[0].start).toBe("2026-10-01T08:15:00.000Z");
    expect(result.at(-1)?.end).toBe("2026-10-01T11:45:00.000Z");
    expect(result[0].bookable).toBe(true);
  });
  it("blocks confirmed and tentative master events including buffers", () => {
    const result = suggestSlots({ ...input, events: [{ id: "1", calendarId: "master", title: "", timezone: "Europe/Stockholm", allDay: false, start: "2026-10-01T08:00:00Z", end: "2026-10-01T10:00:00Z", status: "tentative", blocksAvailability: true }] });
    expect(result[0].start).toBe("2026-10-01T10:15:00.000Z");
  });
  it("does not book before reconciliation or fresh sync", () => {
    expect(suggestSlots({ ...input, reconciled: false }).every(s => !s.bookable)).toBe(true);
    expect(suggestSlots({ ...input, syncFresh: false }).every(s => !s.bookable)).toBe(true);
  });
  it("never invents travel time for physical meetings", () => {
    const result = suggestSlots({ ...input, physical: true });
    expect(result[0].travelStatus).toBe("TRAVEL_TIME_UNKNOWN");
    expect(result[0].bookable).toBe(false);
  });
  it("blocks active holds but releases expired holds", () => {
    const hold = { id: "h", conversationId: "c", start: input.windows[0].start, end: input.windows[0].end, status: "active" as const, expiresAt: "2026-09-16T10:00:00Z" };
    expect(suggestSlots({ ...input, holds: [hold] })).toEqual([]);
    expect(suggestSlots({ ...input, holds: [{ ...hold, expiresAt: input.now }] }).length).toBeGreaterThan(0);
  });
  it("rejects timezone ambiguity and unbounded loops", () => {
    expect(() => suggestSlots({ ...input, now: "2026-09-15T10:00:00" })).toThrow();
    expect(() => suggestSlots({ ...input, preferences: { ...input.preferences, stepMinutes: 0 } })).toThrow();
  });
});
