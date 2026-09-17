import {describe,it,expect,vi} from "vitest";
import {transferBatch} from "./transfer-batch";
import {refreshBookingCalendars} from "./booking-preflight";
import type {CalendarEvent} from "./types";
const events=[1,2,3].map(n=>({id:String(n),calendarId:"source",title:`Möte ${n}`,timezone:"UTC",start:"2099-01-01T10:00:00Z",end:"2099-01-01T11:00:00Z",allDay:false,status:"confirmed",blocksAvailability:true} as CalendarEvent));
const ok=()=>({ok:true,json:async()=>({success:true})});
describe("approved calendar batches",()=>{
 it("uses explicit per-event fingerprints and never bulk-approves reconciliation",async()=>{
  const transport=vi.fn().mockImplementation(ok);expect(await transferBatch("source",events,vi.fn(),transport)).toBe(3);
  expect(transport.mock.calls.map(c=>JSON.parse(c[1].body).action)).toEqual(["transfer","transfer","transfer"]);
  expect(JSON.parse(transport.mock.calls[0][1].body)).toMatchObject({eventId:"1",approved:true,fingerprint:expect.any(String)});
 });
 it("stops on first uncertain outcome and reports confirmed count",async()=>{
  const transport=vi.fn().mockResolvedValueOnce(ok()).mockRejectedValueOnce(new Error("Timeout"));
  await expect(transferBatch("source",events,vi.fn(),transport)).rejects.toThrow("1 av 3 bekräftade");expect(transport).toHaveBeenCalledTimes(2);
 });
 it("refreshes all enabled sources before booking without a review or write-event action",async()=>{
  const transport=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({sources:[{id:"a",enabled:true},{id:"b",enabled:false},{id:"c",enabled:true}]})}).mockImplementation(ok);
  await refreshBookingCalendars(vi.fn(),transport);
  expect(transport.mock.calls.slice(1).map(c=>JSON.parse(c[1].body))).toEqual([{action:"sync",sourceId:"a"},{action:"sync",sourceId:"c"}]);
 });
 it("fails closed when a source cannot be refreshed",async()=>{
  const transport=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({sources:[{id:"a",enabled:true},{id:"b",enabled:true}]})}).mockResolvedValueOnce({ok:false,json:async()=>({error:"Återanslut"})});
  await expect(refreshBookingCalendars(vi.fn(),transport)).rejects.toThrow("Återanslut");expect(transport).toHaveBeenCalledTimes(2);
 });
});
