import {afterEach,describe,expect,it,vi} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
vi.mock("./service",()=>({calendarToken:vi.fn(),syncCalendar:vi.fn()}));
import {executeEventAction,validateEditableEvent} from "./event-actions";
import {calendarToken,syncCalendar} from "./service";
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
function database(status="proposed",kind="rename") {
 const writes:Record<string,unknown>[]=[];
 const plan={id:"plan",source_id:"master",event_id:"event",kind,status,new_title:"New",expected_etag:"v1",expires_at:"2099-01-01T00:00:00Z"};
 const db={from:(table:string)=>{
  const q={select:()=>q,eq:()=>q,update:(v:Record<string,unknown>)=>{writes.push(v);return q;},single:async()=>({data:table==="calendar_sources"?{id:"master",account_id:"account",external_id:"external"}:plan,error:null}),maybeSingle:async()=>({data:{id:"plan"},error:null}),then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({error:null}).then(resolve)};return q;
 }};
 vi.mocked(calendarToken).mockResolvedValue({account:{provider:"google"},token:"synthetic"} as Awaited<ReturnType<typeof calendarToken>>);
 vi.mocked(syncCalendar).mockResolvedValue(1);
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
});
