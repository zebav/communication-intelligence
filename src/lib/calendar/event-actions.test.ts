import {afterEach,describe,expect,it,vi} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
vi.mock("./service",()=>({calendarToken:vi.fn(),syncCalendar:vi.fn()}));
vi.mock("./suggestions-service",()=>({calendarSuggestions:vi.fn()}));
import {executeEventAction,validateEditableEvent} from "./event-actions";
import {calendarToken,syncCalendar} from "./service";
import {calendarSuggestions} from "./suggestions-service";
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
function database(status="proposed",kind="rename") {
 const writes:Record<string,unknown>[]=[];
 const plan={id:"plan",source_id:"master",event_id:"event",kind,status,new_title:"New",expected_etag:"v1",expires_at:"2099-01-01T00:00:00Z",target_start:"2098-01-01T10:00:00Z",target_end:"2098-01-01T11:00:00Z",hold_id:"move-hold"};
 const db={from:(table:string)=>{
  const q={select:()=>q,eq:()=>q,update:(v:Record<string,unknown>)=>{writes.push(v);return q;},single:async()=>({data:table==="calendar_sources"?{id:"master",account_id:"account",external_id:"external",timezone:"UTC"}:table==="calendar_workspace"?{timezone:"UTC"}:plan,error:null}),maybeSingle:async()=>({data:{id:"plan"},error:null}),then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({error:null}).then(resolve)};return q;
 }};
 vi.mocked(calendarToken).mockResolvedValue({account:{provider:"google"},token:"synthetic"} as Awaited<ReturnType<typeof calendarToken>>);
 vi.mocked(syncCalendar).mockResolvedValue(1);
 vi.mocked(calendarSuggestions).mockResolvedValue({slots:[{start:plan.target_start,end:plan.target_end,bookable:true,timezone:"UTC",travelStatus:"NOT_REQUIRED",score:1,explanation:[]}],timezone:"UTC",preparation:10,recovery:10});
 return {db:db as unknown as SupabaseClient,writes};
}
describe("approved master event boundary",()=>{
 it("permits a versioned one-off personal event",()=>expect(validateEditableEvent({id:"a",etag:"v1"}).id).toBe("a"));
 it.each([{attendees:[{email:"test@example.invalid"}]},{recurrence:["RRULE:FREQ=WEEKLY"]},{recurringEventId:"series"},{status:"cancelled"}])("rejects unsafe edit %j",extra=>expect(()=>validateEditableEvent({id:"a",etag:"v1",...extra})).toThrow());
 it("requires a provider version before approval",()=>expect(()=>validateEditableEvent({id:"a"})).toThrow());
 it("conditionally patches exactly once after a fresh read",async()=>{
  const {db,writes}=database();const transport=vi.fn().mockResolvedValueOnce(Response.json({id:"event",etag:"v1"})).mockResolvedValueOnce(Response.json({id:"event"}));vi.stubGlobal("fetch",transport);
  await executeEventAction(db,"owner","plan");
  expect(transport).toHaveBeenCalledTimes(2);expect(transport.mock.calls[1][1].headers["If-Match"]).toBe("v1");
  expect(transport.mock.calls[1][0]).toContain("sendUpdates=none");expect(writes.map(w=>w.status)).toEqual(["executing","completed"]);
 });
 it("does not overwrite a changed provider event",async()=>{
  const {db,writes}=database();const transport=vi.fn().mockResolvedValue(Response.json({id:"event",etag:"v2"}));vi.stubGlobal("fetch",transport);
  await expect(executeEventAction(db,"owner","plan")).rejects.toThrow("ändrats");expect(transport).toHaveBeenCalledTimes(1);expect(writes[0].status).toBe("stale");
 });
 it("does not repeat a write with uncertain outcome",async()=>{
  const {db}=database("executing");const transport=vi.fn().mockResolvedValue(Response.json({id:"event",etag:"v1"}));vi.stubGlobal("fetch",transport);
  await expect(executeEventAction(db,"owner","plan")).rejects.toThrow("osäkert");expect(transport).toHaveBeenCalledTimes(1);
 });
 it("recovers a completed cancellation without deleting twice",async()=>{
  const {db,writes}=database("executing","cancel");const transport=vi.fn().mockResolvedValue(new Response(null,{status:410}));vi.stubGlobal("fetch",transport);
  expect(await executeEventAction(db,"owner","plan")).toEqual({completed:true});expect(transport).toHaveBeenCalledTimes(1);expect(writes[0].status).toBe("completed");
 });
 it("moves the same event after rechecking the reserved target",async()=>{
  const {db,writes}=database("proposed","move");const transport=vi.fn().mockResolvedValueOnce(Response.json({id:"event",etag:"v1"})).mockResolvedValueOnce(Response.json({id:"event"}));vi.stubGlobal("fetch",transport);
  await executeEventAction(db,"owner","plan");
  expect(calendarSuggestions).toHaveBeenCalledWith(db,"owner",expect.anything(),"move-hold");
  expect(transport.mock.calls[1][1].method).toBe("PATCH");expect(transport.mock.calls[1][0]).toContain("/events/event?");
  const body=JSON.parse(transport.mock.calls[1][1].body);expect(body.start.dateTime).toBe("2098-01-01T10:00:00Z");expect(body.summary).toBeUndefined();expect(writes.map(w=>w.status)).toEqual(["executing","completed"]);
 });
 it("blocks a move if the target no longer follows planning rules",async()=>{
  const {db,writes}=database("proposed","move");vi.mocked(calendarSuggestions).mockResolvedValue({slots:[],timezone:"UTC",preparation:10,recovery:10});const transport=vi.fn().mockResolvedValue(Response.json({id:"event",etag:"v1"}));vi.stubGlobal("fetch",transport);
  await expect(executeEventAction(db,"owner","plan")).rejects.toThrow("nya tiden");expect(transport).toHaveBeenCalledTimes(1);expect(writes).toHaveLength(0);
 });
 it("only recovers a move at the exact approved time",async()=>{
  const {db}=database("executing","move");const transport=vi.fn().mockResolvedValue(Response.json({id:"event",extendedProperties:{private:{ciActionId:"plan"}},start:{dateTime:"2098-01-01T12:00:00Z"},end:{dateTime:"2098-01-01T13:00:00Z"}}));vi.stubGlobal("fetch",transport);
  await expect(executeEventAction(db,"owner","plan")).rejects.toThrow("osäkert");expect(transport).toHaveBeenCalledTimes(1);
 });
});
