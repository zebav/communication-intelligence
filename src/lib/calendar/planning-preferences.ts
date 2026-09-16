import { z } from "zod";
import { zonedInstant } from "./time";
import type { TimeRange } from "./types";

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const planningPreferencesSchema = z.object({
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(days => new Set(days).size === days.length),
  dayStart: clock,
  dayEnd: clock,
  minimumNoticeMinutes: z.number().int().min(0).max(10080),
  maximumMeetingMinutesPerDay: z.number().int().min(30).max(1440),
  preparationMinutes: z.number().int().min(0).max(180),
  recoveryMinutes: z.number().int().min(0).max(180),
}).strict().refine(p => p.dayStart < p.dayEnd, "Dagens sluttid måste vara efter starttiden.");
export type PlanningPreferences = z.infer<typeof planningPreferencesSchema>;
// No silent business-hours restriction until the user explicitly saves rules.
export const defaultPlanningPreferences: PlanningPreferences = {
  weekdays: [0, 1, 2, 3, 4, 5, 6], dayStart: "08:00", dayEnd: "21:00",
  minimumNoticeMinutes: 0, maximumMeetingMinutesPerDay: 780,
  preparationMinutes: 10, recoveryMinutes: 10,
};
export function planningWindow(date: string, timezone: string, preferences: PlanningPreferences): TimeRange[] {
  const p = planningPreferencesSchema.parse(preferences);
  const noon = new Date(date + "T12:00:00Z");
  if (!Number.isFinite(noon.getTime()) || noon.toISOString().slice(0, 10) !== date) throw new Error("Ogiltigt datum.");
  if (!p.weekdays.includes(noon.getUTCDay())) return [];
  return [{ start: zonedInstant(date + "T" + p.dayStart, timezone), end: zonedInstant(date + "T" + p.dayEnd, timezone) }];
}

/** Union, not sum: the same appointment on two calendars must not count twice. */
export function occupiedMinutes(ranges: TimeRange[], window: TimeRange): number {
  const start = Date.parse(window.start), end = Date.parse(window.end);
  const intervals = ranges.map(r => [Math.max(start, Date.parse(r.start)), Math.min(end, Date.parse(r.end))])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && a < b).sort((a, b) => a[0] - b[0]);
  let total = 0, cursor = start;
  for (const [a, b] of intervals) { total += Math.max(0, b - Math.max(a, cursor)); cursor = Math.max(cursor, b); }
  return total / 60_000;
}
