import type { CalendarEvent, CalendarHold, SchedulingPreferences, TimeRange } from "./types";
import { occupiedMinutes } from "./planning-preferences";

const minute = 60_000;
function instant(value: string) {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Explicit timezone offset required");
  return Date.parse(value);
}
function interval(range: TimeRange) {
  const start = instant(range.start), end = instant(range.end);
  if (end <= start) throw new Error("Invalid time range");
  return { start, end };
}
export type SchedulingCandidate = TimeRange & {
  timezone: string; bookable: boolean; travelStatus: "NOT_REQUIRED" | "TRAVEL_TIME_UNKNOWN";
  score: number; explanation: string[];
};
export function suggestSlots(input: {
  windows: TimeRange[]; events: CalendarEvent[]; holds: CalendarHold[];
  preferences: SchedulingPreferences; physical: boolean;
  reconciled: boolean; syncFresh: boolean; now: string;
  minimumNoticeMinutes?: number; maximumMeetingMinutesPerDay?: number;
}): SchedulingCandidate[] {
  const p = input.preferences;
  new Intl.DateTimeFormat("en", { timeZone: p.timezone }).format();
  for (const [key, value] of Object.entries(p)) {
    if (key !== "timezone" && (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 1440)) throw new Error("Invalid scheduling preference");
  }
  if (p.durationMinutes < 1 || p.stepMinutes < 1) throw new Error("Duration and step must be positive");
  const now = instant(input.now);
  const notice = input.minimumNoticeMinutes ?? 0;
  const maximum = input.maximumMeetingMinutesPerDay ?? 1440;
  if (!Number.isInteger(notice) || notice < 0 || notice > 10080 || !Number.isInteger(maximum) || maximum < 1 || maximum > 1440) throw new Error("Invalid planning rules");
  const busy = [
    ...input.events.filter(e => e.blocksAvailability && e.status !== "cancelled"),
    ...input.holds.filter(h => h.status === "active" && instant(h.expiresAt) > now),
  ].map(interval);
  const results: SchedulingCandidate[] = [];
  const seen = new Set<number>();
  let iterations = 0;
  for (const window of input.windows) {
    const range = interval(window);
    if (occupiedMinutes(busy.map(b => ({start:new Date(b.start).toISOString(),end:new Date(b.end).toISOString()})), window) + p.durationMinutes > maximum) continue;
    const anchor=range.start+p.preparationMinutes*minute;
    const first=anchor+Math.max(0,Math.ceil((now+(notice+p.preparationMinutes)*minute-anchor)/(p.stepMinutes*minute)))*p.stepMinutes*minute;
    for (let start = first; start + (p.durationMinutes + p.recoveryMinutes) * minute <= range.end; start += p.stepMinutes * minute) {
      if (++iterations > 10000) throw new Error("Scheduling range too large");
      const end = start + p.durationMinutes * minute;
      if (seen.has(start) || busy.some(b => start - p.preparationMinutes * minute < b.end && end + p.recoveryMinutes * minute > b.start)) continue;
      seen.add(start);
      const explanation = ["Ingen konflikt i masterkalendern eller aktiva reservationer.", "Förberedelse och återhämtning ryms i tidsfönstret."];
      if (!input.reconciled) explanation.push("Befintliga åtaganden måste först stämmas av.");
      if (!input.syncFresh) explanation.push("Kalendern måste synkroniseras före bokning.");
      if (input.physical) explanation.push("Restid är okänd och måste kontrolleras före bokning.");
      results.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), timezone: p.timezone,
        bookable: input.reconciled && input.syncFresh && !input.physical,
        travelStatus: input.physical ? "TRAVEL_TIME_UNKNOWN" : "NOT_REQUIRED",
        score: input.reconciled && input.syncFresh && !input.physical ? 1 : 0.5, explanation });
    }
  }
  return results.sort((a,b) => b.score-a.score || a.start.localeCompare(b.start)).slice(0,20);
}
