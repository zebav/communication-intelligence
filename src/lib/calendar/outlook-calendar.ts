import { z } from "zod";
import type { TimeRange } from "./types";

// Read-only source calendars. Nothing in this adapter accepts or creates a booking.
export const outlookCalendarScopes = ["Calendars.Read"] as const;
const graphRoot = "https://graph.microsoft.com/v1.0/";
const moment = z.object({ dateTime: z.string(), timeZone: z.string() });
const eventSchema = z.object({
  id: z.string(), subject: z.string().default(""), isCancelled: z.boolean().default(false),
  isAllDay: z.boolean().default(false), start: moment, end: moment,
  showAs: z.string(), responseStatus: z.object({ response: z.string() }).optional(),
  seriesMasterId: z.string().optional(), changeKey: z.string().optional(),
  location: z.object({ displayName: z.string().optional() }).optional(),
});
export function normalizeOutlookEvent(raw: unknown, calendarId: string) {
  const e = eventSchema.parse(raw);
  // The request explicitly selects UTC. Reject unexpected zones rather than
  // silently interpreting Windows timezone names in the browser's local zone.
  const utc = (t: z.infer<typeof moment>) => {
    if (t.timeZone !== "UTC") throw new Error("Unexpected Outlook response timezone");
    const value = /(?:Z|[+-]\d{2}:\d{2})$/.test(t.dateTime) ? t.dateTime : t.dateTime + "Z";
    if (!Number.isFinite(Date.parse(value))) throw new Error("Invalid Outlook event time");
    return new Date(value).toISOString();
  };
  const start=utc(e.start), end=utc(e.end);
  if (Date.parse(end)<=Date.parse(start)) throw new Error("Invalid Outlook event duration");
  return { id:e.id, calendarId, title:e.subject, start, end, timezone:"UTC", allDay:e.isAllDay,
    status:e.isCancelled ? "cancelled" as const : e.showAs === "tentative" ? "tentative" as const : "confirmed" as const,
    blocksAvailability:!e.isCancelled && e.showAs!=="free" && e.responseStatus?.response!=="declined",
    location:e.location?.displayName, recurrenceId:e.seriesMasterId, etag:e.changeKey };
}
export class OutlookCalendarReader {
  constructor(private readonly accessToken: string, private readonly transport: typeof fetch = fetch) {}
  private async pages(path: string): Promise<unknown[]> {
    let next: string | undefined = graphRoot + path;
    const seen=new Set<string>(), items:unknown[]=[];
    while(next) {
      const url=new URL(next);
      if(url.origin!=="https://graph.microsoft.com" || !url.pathname.startsWith("/v1.0/me/") || url.username || url.password)
        throw new Error("Untrusted Outlook pagination URL");
      if(seen.has(next) || seen.size>=100) throw new Error("Incomplete Outlook calendar pagination");
      seen.add(next);
      const response=await this.transport(next,{headers:{authorization:"Bearer "+this.accessToken,Prefer:'outlook.timezone="UTC"'},cache:"no-store",signal:AbortSignal.timeout(15000)});
      if(!response.ok) throw new Error("Outlook calendar API error "+response.status);
      const page=z.object({value:z.array(z.unknown()),"@odata.nextLink":z.string().optional()}).parse(await response.json());
      items.push(...page.value); next=page["@odata.nextLink"];
    }
    return items;
  }
  async getCalendars() {
    return (await this.pages("me/calendars?$top=100")).map(raw=>{
      const c=z.object({id:z.string(),name:z.string(),canEdit:z.boolean().optional(),owner:z.object({address:z.string().optional()}).optional()}).parse(raw);
      return {id:c.id,name:c.name,access:c.canEdit?"writer":"reader",accountAddress:c.owner?.address};
    });
  }
  async getEvents(calendarId:string,range:TimeRange) {
    for(const value of [range.start,range.end]) if(!/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Explicit calendar timezone required");
    if(Date.parse(range.end)<=Date.parse(range.start) || Date.parse(range.end)-Date.parse(range.start)>93*86400000) throw new Error("Calendar window must be 1–93 days");
    // calendarView expands recurring events and their exceptions in this window.
    const query=new URLSearchParams({startDateTime:range.start,endDateTime:range.end,$top:"250"});
    const raw=await this.pages("me/calendars/"+encodeURIComponent(calendarId)+"/calendarView?"+query);
    return raw.map(e=>normalizeOutlookEvent(e,calendarId));
  }
}
