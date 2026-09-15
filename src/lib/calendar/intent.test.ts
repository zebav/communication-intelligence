import {it,expect} from "vitest";
import {schedulingIntent} from "./intent";
it("discovers a dinner request without inventing next Wednesday",()=>expect(schedulingIntent("Kan vi ses på middag nästa onsdag?")).toMatchObject({detected:true,type:"DINNER",date:undefined,needsDateConfirmation:true}));
it("retains an explicit date for review",()=>expect(schedulingIntent("Meeting 2026-10-12?").date).toBe("2026-10-12"));
it("ignores ordinary informational text",()=>expect(schedulingIntent("Tack för informationen").detected).toBe(false));
it("does not choose an old date from a thread with several dates",()=>expect(schedulingIntent("Möte 2026-10-12 eller 2026-10-13?")).toMatchObject({date:undefined,needsDateConfirmation:true}));
it("separates rescheduling and cancellation from new invitations",()=>{
 expect(schedulingIntent("Vi måste avboka mötet").operation).toBe("cancel");
 expect(schedulingIntent("Kan vi flytta mötet?").operation).toBe("change");
});
