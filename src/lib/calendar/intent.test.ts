import {it,expect} from "vitest";
import {schedulingIntent} from "./intent";
it("discovers a dinner request without inventing next Wednesday",()=>expect(schedulingIntent("Kan vi ses på middag nästa onsdag?")).toMatchObject({detected:true,type:"DINNER",date:undefined,needsDateConfirmation:true}));
it("retains an explicit date for review",()=>expect(schedulingIntent("Meeting 2026-10-12?").date).toBe("2026-10-12"));
it("ignores ordinary informational text",()=>expect(schedulingIntent("Tack för informationen").detected).toBe(false));
