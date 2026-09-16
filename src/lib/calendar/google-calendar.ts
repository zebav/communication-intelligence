import { z } from "zod";
import { zonedInstant } from "./time";
import type { TimeRange } from "./types";

// Kept separate from Gmail: adding these to an authorization request requires
// explicit Calendar consent. This module does not change current OAuth scopes.
export const googleCalendarScopes = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
  "https://www.googleapis.com/auth/calendar.app.created",
] as const;

const time = z.object({ date: z.string().optional(), dateTime: z.string().optional(), timeZone: z.string().optional() });
const event = z.object({
  id: z.string(), summary: z.string().optional(), status: z.enum(["confirmed", "tentative", "cancelled"]).optional(),
  start: time.optional(), end: time.optional(), transparency: z.string().optional(),
  recurringEventId: z.string().optional(), recurrence: z.array(z.string()).optional(),
  originalStartTime: time.optional(), location: z.string().optional(), etag: z.string().optional(),
  description: z.string().optional(), hangoutLink: z.string().optional(),
  attendees: z.array(z.object({ email: z.string().optional(), responseStatus: z.string().optional(), self: z.boolean().optional() })).optional(),
});
export function normalizeGoogleEvent(raw: unknown, calendarId: string, calendarTimezone: string) {
  const e = event.parse(raw);
  // Cancelled tombstones may contain only an ID. Never invent timestamps.
  if (e.status === "cancelled") return { id: e.id, calendarId, status: "cancelled" as const };
  if (!e.start || !e.end || (!e.start.dateTime && !e.start.date) || (!e.end.dateTime && !e.end.date)) throw new Error("Calendar event has incomplete time data");
  return {
    id: e.id, calendarId, title: e.summary ?? "", status: e.status ?? "confirmed",
    timezone: e.start.timeZone ?? calendarTimezone,
    // All-day dates have exclusive end dates and must not be parsed as UTC midnight.
    start: e.start.dateTime ?? e.start.date!, end: e.end.dateTime ?? e.end.date!,
    allDay: Boolean(e.start.date), location: e.location, etag: e.etag,
    blocksAvailability: e.transparency !== "transparent" && !e.attendees?.some(a => a.self && a.responseStatus === "declined"),
    recurrenceId: e.recurringEventId, recurrence: e.recurrence,
    originalStartTime: e.originalStartTime, description: e.description,
    meetingUrl: e.hangoutLink, attendees: e.attendees ?? [],
  };
}
export class CalendarSyncResetRequired extends Error {}
export class GoogleCalendarReader {
  constructor(private readonly accessToken: string, private readonly transport: typeof fetch = fetch) {}
  private async read(path: string) {
    const response = await this.transport("https://www.googleapis.com/calendar/v3/" + path, {
      headers: { authorization: "Bearer " + this.accessToken },
      signal: AbortSignal.timeout(15000), cache: "no-store",
    });
    if (response.status === 410) throw new CalendarSyncResetRequired("Full resync required; retain last good snapshot until replacement is complete");
    if (!response.ok) throw new Error("Calendar API error " + response.status);
    return response.json();
  }
  async getCalendars() {
    const calendars = []; let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const raw = await this.read("users/me/calendarList?" + new URLSearchParams({ maxResults: "250", ...(cursor ? { pageToken: cursor } : {}) }));
      const page = z.object({ items: z.array(z.object({ id: z.string(), summary: z.string(), timeZone: z.string(), accessRole: z.string() })).default([]), nextPageToken: z.string().optional() }).parse(raw);
      calendars.push(...page.items.map(c => ({ id: c.id, name: c.summary, timezone: c.timeZone, access: c.accessRole })));
      cursor = page.nextPageToken;
      if (cursor && seen.has(cursor)) throw new Error("Repeated calendar cursor");
      if (cursor) seen.add(cursor);
      if (seen.size > 100) throw new Error("Calendar page limit exceeded");
    } while (cursor);
    return calendars;
  }
  async getEvents(calendarId:string, range:TimeRange, timezone:string) {
    const events=[]; let cursor:string|undefined; const seen=new Set<string>();
    do {
      const query=new URLSearchParams({timeMin:range.start,timeMax:range.end,singleEvents:"true",showDeleted:"false",maxResults:"250",...(cursor?{pageToken:cursor}:{})});
      const page=z.object({items:z.array(z.unknown()).default([]),nextPageToken:z.string().optional()}).parse(await this.read("calendars/"+encodeURIComponent(calendarId)+"/events?"+query));
      for(const raw of page.items) {
        const event=normalizeGoogleEvent(raw,calendarId,timezone);
        if(!("start" in event)) continue;
        events.push({...event,start:event.allDay?zonedInstant(event.start+"T00:00",event.timezone):event.start,end:event.allDay?zonedInstant(event.end+"T00:00",event.timezone):event.end});
      }
      cursor=page.nextPageToken;
      if(cursor && (seen.has(cursor)||seen.size>=100)) throw new Error("Incomplete calendar snapshot");
      if(cursor) seen.add(cursor);
    } while(cursor);
    return events;
  }
  async syncChanges(calendarId: string, syncToken?: string) {
    const events = []; let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const query = new URLSearchParams({ maxResults: "250", showDeleted: "true", singleEvents: "false", ...(syncToken ? { syncToken } : {}), ...(cursor ? { pageToken: cursor } : {}) });
      const raw = await this.read("calendars/" + encodeURIComponent(calendarId) + "/events?" + query);
      const page = z.object({ items: z.array(z.unknown()).default([]), timeZone: z.string(), nextPageToken: z.string().optional(), nextSyncToken: z.string().optional() }).parse(raw);
      events.push(...page.items.map(e => normalizeGoogleEvent(e, calendarId, page.timeZone)));
      cursor = page.nextPageToken;
      if (!cursor) {
        if (!page.nextSyncToken) throw new Error("Missing final sync token");
        return { events, nextCursor: page.nextSyncToken };
      }
      if (seen.has(cursor) || seen.size >= 100) throw new Error("Invalid or excessive event pagination");
      seen.add(cursor);
    } while (cursor);
    throw new Error("Incomplete calendar sync");
  }
}
