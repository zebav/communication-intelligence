import type { CalendarEvent } from "./types";
export function transferFingerprint(event:CalendarEvent) {
  return JSON.stringify([event.id,event.title,event.start,event.end,event.timezone,event.allDay,event.location??"",event.status,event.blocksAvailability,event.etag??""]);
}
export function transferPayload(event:CalendarEvent,id:string,transferId:string) {
  const date=(value:string)=>new Intl.DateTimeFormat("sv-SE",{timeZone:event.timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value));
  return {id,summary:event.title,location:event.location,status:event.status,
    start:event.allDay?{date:date(event.start)}:{dateTime:event.start,timeZone:event.timezone},
    end:event.allDay?{date:date(event.end)}:{dateTime:event.end,timeZone:event.timezone},
    transparency:event.blocksAvailability?"opaque":"transparent",
    extendedProperties:{private:{transferId}},
    description:"Överfört från extern kalender efter ditt godkännande. Originalet är oförändrat. Inga inbjudningar har skickats."};
}
