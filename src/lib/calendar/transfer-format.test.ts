import {expect,it} from "vitest";
import {transferEventId} from "./commitment-transfer";
import {transferPayload,transferFingerprint} from "./transfer-format";
import type {CalendarEvent} from "./types";
const event:CalendarEvent={id:"external",calendarId:"source",title:"Möte",start:"2026-10-01T08:00:00Z",end:"2026-10-01T09:00:00Z",timezone:"Europe/Stockholm",allDay:false,status:"confirmed",blocksAvailability:true};
it("retries use the same valid Google ID and owners never collide",()=>{
 const id=transferEventId("owner","source","external");
 expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
 expect(transferEventId("owner","source","external")).toBe(id);
 expect(transferEventId("other","source","external")).not.toBe(id);
});
it("copies exact times with no invitations and preserves exclusive all-day dates",()=>{
 const payload=transferPayload(event,"id","transfer");
 expect(payload).not.toHaveProperty("attendees");
 expect(payload.start).toEqual({dateTime:event.start,timeZone:event.timezone});
 expect(transferPayload({...event,allDay:true,start:"2026-09-30T22:00:00Z",end:"2026-10-01T22:00:00Z"},"id","transfer")).toMatchObject({start:{date:"2026-10-01"},end:{date:"2026-10-02"}});
});
it("source revision changes invalidate the approval fingerprint",()=>expect(transferFingerprint({...event,etag:"new"})).not.toBe(transferFingerprint(event)));
