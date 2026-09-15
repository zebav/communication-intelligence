import {afterEach,describe,expect,it,vi} from "vitest";
import {confirmHold,createMaster} from "./service";
import type {SupabaseClient} from "@supabase/supabase-js";
vi.mock("../connectors/credential-crypto",()=>({decryptCredential:()=>({accessToken:"test-token",refreshToken:"test-refresh",expiresAt:"2099-01-01T00:00:00Z"}),encryptCredential:()=>"encrypted"}));
const owner="owner",hold={id:"00000000-0000-0000-0000-000000000001",owner_id:owner,status:"active",starts_at:"2026-10-01T10:00:00Z",ends_at:"2026-10-01T11:00:00Z",title:"Test",preparation_minutes:10,recovery_minutes:10};
function fakeDb(status="active",provisioning="idle") {
 const writes:Record<string,unknown>[]=[];
 const db={from:(table:string)=>{
  let write:Record<string,unknown>|undefined;
  const result=()=>({data:table==="calendar_holds"?{...hold,status}:table==="calendar_sources"?{id:"master",is_master:true,account_id:"account",external_id:"google-master",timezone:"UTC",window_start:"2026-09-30T00:00:00Z",window_end:"2026-10-03T00:00:00Z"}:table==="calendar_accounts"?{id:"account",provider:"google",encrypted_credentials:"cipher"}:provisioning==="idle"?{owner_id:owner}:null,error:null});
  const q={select:()=>q,eq:()=>q,is:()=>q,gt:()=>q,gte:()=>q,lte:()=>q,update:(value:Record<string,unknown>)=>{write=value;writes.push({table,...value});return q;},insert:(value:Record<string,unknown>)=>{write=value;writes.push({table,...value});return q;},single:async()=>result(),maybeSingle:async()=>result(),then:(resolve:(x:unknown)=>unknown)=>Promise.resolve({data:write??[],error:null}).then(resolve)};
  return q;
 }};
 return {db:db as unknown as SupabaseClient,writes};
}
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe("calendar execution safety",()=>{
 it("checks fresh events, claims the hold, and creates only the approved private event",async()=>{
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY","test");
  const fetcher=vi.fn().mockResolvedValueOnce(new Response("",{status:404})).mockResolvedValueOnce(Response.json({items:[]})).mockResolvedValueOnce(Response.json({id:"created"}));
  vi.stubGlobal("fetch",fetcher);const {db,writes}=fakeDb();await confirmHold(db,owner,hold.id);
  expect(fetcher).toHaveBeenCalledTimes(3);
  const [url,options]=fetcher.mock.calls[2];expect(url).toContain("sendUpdates=none");
  const body=JSON.parse(options.body);expect(body.start.dateTime).toBe(hold.starts_at);expect(body.attendees).toBeUndefined();expect(body.extendedProperties.private.holdId).toBe(hold.id);
  expect(writes.filter(w=>w.table==="calendar_holds").map(w=>w.status)).toEqual(["executing","confirmed"]);
 });
 it("recovers an already-created event without sending a second POST",async()=>{
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY","test");
  const fetcher=vi.fn().mockResolvedValue(Response.json({extendedProperties:{private:{holdId:hold.id}},start:{dateTime:hold.starts_at},end:{dateTime:hold.ends_at},status:"confirmed"}));
  vi.stubGlobal("fetch",fetcher);const {db,writes}=fakeDb("executing");
  await confirmHold(db,owner,hold.id);
  expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][1].method).toBeUndefined();
  expect(writes).toContainEqual({table:"calendar_holds",status:"confirmed",external_event_id:"ci00000000000000000000000000000001"});
 });
 it("does not retry an uncertain creation with a new event ID",async()=>{
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY","test");const fetcher=vi.fn().mockResolvedValue(new Response("",{status:404}));vi.stubGlobal("fetch",fetcher);
  await expect(confirmHold(fakeDb("executing").db,owner,hold.id)).rejects.toThrow("osäkert");
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it("does not accept a remotely moved event as the approved time",async()=>{
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY","test");vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({extendedProperties:{private:{holdId:hold.id}},start:{dateTime:"2026-10-01T14:00:00Z"},end:{dateTime:hold.ends_at}})));
  const {db,writes}=fakeDb("executing");await expect(confirmHold(db,owner,hold.id)).rejects.toThrow("ändrats");expect(writes).toHaveLength(0);
 });
 it("does not create another master while an earlier request is uncertain",async()=>{
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY","test");const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  await expect(createMaster(fakeDb("active","uncertain").db,owner,"account","UTC")).rejects.toThrow("tidigare försök");expect(fetcher).not.toHaveBeenCalled();
 });
});
