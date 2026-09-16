import {describe,it,expect} from "vitest";
import {zonedInstant} from "./time";
describe("calendar wall times",()=>{
 it("uses the selected zone, not the server zone",()=>expect(zonedInstant("2026-09-16T10:00","Europe/Stockholm")).toBe("2026-09-16T08:00:00.000Z"));
 it("handles a 25-hour all-day event",()=>expect(Date.parse(zonedInstant("2026-10-26T00:00","Europe/Stockholm"))-Date.parse(zonedInstant("2026-10-25T00:00","Europe/Stockholm"))).toBe(25*3600000));
 it("rejects nonexistent spring times",()=>expect(()=>zonedInstant("2026-03-29T02:30","Europe/Stockholm")).toThrow());
 it("rejects ambiguous autumn times",()=>expect(()=>zonedInstant("2026-10-25T02:30","Europe/Stockholm")).toThrow());
});
