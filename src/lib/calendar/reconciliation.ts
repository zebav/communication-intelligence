import type { CalendarEvent } from "./types";

export type CommitmentReview = {
  event: CalendarEvent;
  status: "matched" | "conflict" | "missing" | "informational";
  masterEventIds: string[];
};
/** Suggestions only. Similar titles are never sufficient to merge or overwrite events. */
export function reviewCommitments(external: CalendarEvent[], master: CalendarEvent[]): CommitmentReview[] {
  const blocking = master.filter(e => e.status !== "cancelled" && e.blocksAvailability);
  return external.filter(e => e.status !== "cancelled").map(event => {
    if (!event.blocksAvailability) return { event, status: "informational", masterEventIds: [] };
    const matches = blocking.filter(m => m.title.trim().toLocaleLowerCase() === event.title.trim().toLocaleLowerCase()
      && Boolean(event.title.trim()) && Date.parse(m.start) === Date.parse(event.start) && Date.parse(m.end) === Date.parse(event.end)
      && (m.location ?? "").trim().toLocaleLowerCase() === (event.location ?? "").trim().toLocaleLowerCase());
    if (matches.length) return { event, status: "matched", masterEventIds: matches.map(m => m.id) };
    const overlaps = blocking.filter(m => Date.parse(m.start) < Date.parse(event.end) && Date.parse(m.end) > Date.parse(event.start));
    return { event, status: overlaps.length ? "conflict" : "missing", masterEventIds: overlaps.map(m => m.id) };
  });
}
