import {afterEach,describe,expect,it,vi} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
import {runCalendarSyncTick} from "./background-sync";
const mocks=vi.hoisted(()=>({token:vi.fn(),events:vi.fn()}));
vi.mock("./service",()=>({calendarToken:mocks.token}));
vi.mock("./google-calendar",()=>({GoogleCalendarReader:class {getEvents=mocks.events;}}));
function database(published=true,idle=false) {
 const rpc=vi.fn(async(name:string)=>({data:name==="claim_calendar_sync"?(idle?[]:[{owner_id:"owner",account_id:"account",lease_token:"lease"}]):published,error:null}));
 const query={select:()=>query,eq:()=>query,order:()=>query,limit:()=>query,maybeSingle:async()=>({data:{id:"source",external_id:"remote",timezone:"UTC",synced_at:null},error:null})};
 return {db:{rpc,from:()=>query} as unknown as SupabaseClient,rpc};
}
afterEach(()=>vi.resetAllMocks());
describe("background calendar worker",()=>{
 it("does nothing when no account is due",async()=>{
  expect(await runCalendarSyncTick(database(true,true).db)).toEqual({status:"idle"});
  expect(mocks.token).not.toHaveBeenCalled();
 });
 it("publishes a complete snapshot with its lease",async()=>{
  mocks.token.mockResolvedValue({account:{provider:"google"},token:"test"});
  mocks.events.mockResolvedValue([{id:"b"},{id:"a"}]);
  const {db,rpc}=database();expect(await runCalendarSyncTick(db)).toEqual({status:"synced"});
  expect(rpc).toHaveBeenLastCalledWith("finish_calendar_sync",expect.objectContaining({p_lease:"lease",p_success:true,p_snapshot:[{id:"a"},{id:"b"}]}));
 });
 it("retains the previous snapshot on provider failure",async()=>{
  mocks.token.mockRejectedValue(new Error("provider unavailable"));
  const {db,rpc}=database();expect(await runCalendarSyncTick(db)).toEqual({status:"retry_scheduled"});
  expect(rpc).toHaveBeenLastCalledWith("finish_calendar_sync",expect.objectContaining({p_success:false}));
 });
 it("does not report a superseded publication as successful",async()=>{
  mocks.token.mockResolvedValue({account:{provider:"google"},token:"test"});mocks.events.mockResolvedValue([]);
  expect(await runCalendarSyncTick(database(false).db)).toEqual({status:"superseded"});
 });
});
