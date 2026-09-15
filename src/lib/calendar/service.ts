import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptCredential,encryptCredential } from "../connectors/credential-crypto";
import { GoogleCalendarReader } from "./google-calendar";
import { OutlookCalendarReader } from "./outlook-calendar";
import { googleConfig } from "../connectors/google-oauth";
import { microsoftConfig } from "../connectors/microsoft-oauth";
import type { TimeRange } from "./types";

export async function calendarToken(db:SupabaseClient,owner:string,accountId:string) {
  const {data:account,error}=await db.from("calendar_accounts").select("*").eq("owner_id",owner).eq("id",accountId).single();
  if(error||!account) throw new Error("Kalenderkontot kunde inte läsas.");
  const key=process.env.CREDENTIAL_ENCRYPTION_KEY;
  if(!key) throw new Error("Kalenderns kryptering är inte konfigurerad.");
  const credentials=decryptCredential<{accessToken:string;refreshToken:string;expiresAt:string}>(account.encrypted_credentials,key);
  if(Date.parse(credentials.expiresAt)>Date.now()+60000) return {account,token:credentials.accessToken};
  const config=account.provider==="google"?googleConfig("https://unused.invalid"):microsoftConfig("https://unused.invalid");
  const url=account.provider==="google"?"https://oauth2.googleapis.com/token":`https://login.microsoftonline.com/${microsoftConfig("https://unused.invalid").tenant}/oauth2/v2.0/token`;
  const response=await fetch(url,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,grant_type:"refresh_token",refresh_token:credentials.refreshToken}),signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw new Error("Återanslut kalenderkontot för att förnya åtkomsten.");
  const next=await response.json();
  if(!next.access_token||!Number.isFinite(next.expires_in)) throw new Error("Kalenderåtkomsten kunde inte förnyas.");
  const {error:save}=await db.from("calendar_accounts").update({encrypted_credentials:encryptCredential({accessToken:next.access_token,refreshToken:next.refresh_token||credentials.refreshToken,expiresAt:new Date(Date.now()+next.expires_in*1000).toISOString()},key)}).eq("id",accountId).eq("owner_id",owner);
  if(save) throw new Error("Förnyad kalenderåtkomst kunde inte sparas.");
  return {account,token:next.access_token as string};
}
export async function discoverCalendars(db:SupabaseClient,owner:string,accountId:string) {
  const {account,token}=await calendarToken(db,owner,accountId);
  const calendars=account.provider==="google"?await new GoogleCalendarReader(token).getCalendars():await new OutlookCalendarReader(token).getCalendars();
  for(const c of calendars) {
    const {data:existing,error:read}=await db.from("calendar_sources").select("id").eq("owner_id",owner).eq("account_id",accountId).eq("external_id",c.id).maybeSingle();
    if(read) throw new Error("Kalenderlistan kunde inte läsas.");
    if(!existing) {
      const {error}=await db.from("calendar_sources").insert({owner_id:owner,account_id:accountId,external_id:c.id,name:c.name,timezone:"timezone" in c?c.timezone:"UTC"});
      if(error) throw new Error("Kalenderlistan kunde inte sparas.");
    }
  }
  return calendars.length;
}
export async function syncCalendar(db:SupabaseClient,owner:string,sourceId:string,range:TimeRange) {
  const {data:s,error}=await db.from("calendar_sources").select("*").eq("owner_id",owner).eq("id",sourceId).single();
  if(error||!s) throw new Error("Kalendern finns inte.");
  try {
    const {account,token}=await calendarToken(db,owner,s.account_id);
    const events=account.provider==="google"?await new GoogleCalendarReader(token).getEvents(s.external_id,range,s.timezone):await new OutlookCalendarReader(token).getEvents(s.external_id,range);
    if(events.length>10000) throw new Error("För många bokningar. Välj en kortare period.");
    // One update publishes the complete snapshot; failures retain previous data.
    const {error:save}=await db.from("calendar_sources").update({snapshot:events.sort((a,b)=>a.id.localeCompare(b.id)),window_start:range.start,window_end:range.end,synced_at:new Date().toISOString(),sync_error:null}).eq("id",s.id).eq("owner_id",owner);
    if(save) throw new Error("Synkroniseringen kunde inte sparas.");
    if(s.is_master) {
      const {data:booked,error:readHolds}=await db.from("calendar_holds").select("id,external_event_id,starts_at,ends_at").eq("owner_id",owner).eq("status","confirmed").gte("starts_at",range.start).lte("ends_at",range.end);
      if(readHolds) throw new Error("Bokningsstatus kunde inte stämmas av.");
      for(const hold of booked??[]) {
        const current=events.find(e=>e.id===hold.external_event_id);
        if(!current?.start||!current?.end||Date.parse(current.start)!==Date.parse(hold.starts_at)||Date.parse(current.end)!==Date.parse(hold.ends_at)) {
          const {error:release}=await db.from("calendar_holds").update({status:"released"}).eq("id",hold.id).eq("owner_id",owner).eq("status","confirmed");
          if(release) throw new Error("Ändrad bokning kunde inte stämmas av.");
        }
      }
    }
    return events.length;
  } catch(error) {
    await db.from("calendar_sources").update({sync_error:"Synkroniseringen misslyckades. Tidigare data visas."}).eq("id",s.id).eq("owner_id",owner);
    throw error;
  }
}
export async function createMaster(db:SupabaseClient,owner:string,accountId:string,timezone:string) {
  const {account,token}=await calendarToken(db,owner,accountId);
  if(account.provider!=="google") throw new Error("Masterkalendern ska skapas på ett Google-konto.");
  const {data:claim,error}=await db.from("calendar_workspace").update({provisioning:"creating",timezone}).eq("owner_id",owner).eq("provisioning","idle").select("owner_id").maybeSingle();
  if(error||!claim) throw new Error("Masterkalendern finns redan eller ett tidigare försök behöver kontrolleras.");
  try {
    const response=await fetch("https://www.googleapis.com/calendar/v3/calendars",{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({summary:"Communication Intelligence – Master",timeZone:timezone}),signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw new Error("Google kunde inte skapa masterkalendern.");
    const calendar=await response.json();
    if(!calendar.id) throw new Error("Google returnerade inget kalender-id.");
    const {error:save}=await db.from("calendar_sources").insert({owner_id:owner,account_id:accountId,external_id:calendar.id,name:"Communication Intelligence – Master",timezone,is_master:true});
    if(save) throw new Error("Kalendern skapades hos Google men kunde inte registreras. Skapa inte en till.");
    const {error:ready}=await db.from("calendar_workspace").update({provisioning:"ready"}).eq("owner_id",owner);
    if(ready) throw new Error("Masterkalenderns status kunde inte sparas.");
  } catch(error) {
    await db.from("calendar_workspace").update({provisioning:"uncertain"}).eq("owner_id",owner);
    throw error;
  }
}
export async function confirmHold(db:SupabaseClient,owner:string,holdId:string) {
  const {data:h,error}=await db.from("calendar_holds").select("*").eq("owner_id",owner).eq("id",holdId).single();
  if(error||!h) throw new Error("Reservationen finns inte.");
  if(h.status==="confirmed") return;
  if(h.status!=="active"&&h.status!=="executing") throw new Error("Reservationen är inte aktiv.");
  const {data:master}=await db.from("calendar_sources").select("*").eq("owner_id",owner).eq("is_master",true).single();
  if(!master) throw new Error("Masterkalender saknas.");
  const {token}=await calendarToken(db,owner,master.account_id);
  const eventId="ci"+h.id.replaceAll("-","");
  const endpoint=`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(master.external_id)}/events`;
  // Unknown outcomes can only be retried with the same deterministic event ID.
  const lookup=await fetch(endpoint+"/"+eventId,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
  if(lookup.ok) {
    const existing=await lookup.json();
    if(existing.extendedProperties?.private?.holdId!==h.id || existing.status==="cancelled" || Date.parse(existing.start?.dateTime)!==Date.parse(h.starts_at) || Date.parse(existing.end?.dateTime)!==Date.parse(h.ends_at)) throw new Error("Bokningen har ändrats och behöver kontrolleras manuellt.");
    const {error:save}=await db.from("calendar_holds").update({status:"confirmed",external_event_id:eventId}).eq("id",h.id).eq("owner_id",owner);
    if(save) throw new Error("Bokningen finns hos Google men status kunde inte sparas.");
    return;
  }
  if(lookup.status!==404) throw new Error("Bokningens status kunde inte kontrolleras. Försök senare.");
  if(h.status==="executing") throw new Error("Ett tidigare bokningsförsök är osäkert. Kontrollera Google-kalendern innan nytt försök.");
  // Fresh snapshot and DB trigger serialize local requests and check conflicts.
  await syncCalendar(db,owner,master.id,{start:master.window_start,end:master.window_end});
  const {data:claimed,error:claim}=await db.from("calendar_holds").update({status:"executing",external_event_id:eventId}).eq("id",h.id).eq("owner_id",owner).eq("status","active").gt("expires_at",new Date().toISOString()).select("id").maybeSingle();
  if(claim||!claimed) throw new Error("Tiden kunde inte godkännas. Synkronisera och kontrollera konflikter.");
  const response=await fetch(endpoint+"?sendUpdates=none",{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({id:eventId,summary:h.title,start:{dateTime:h.starts_at,timeZone:master.timezone},end:{dateTime:h.ends_at,timeZone:master.timezone},extendedProperties:{private:{holdId:h.id}},description:`Bokat efter ditt godkännande. Buffert: ${h.preparation_minutes} min före, ${h.recovery_minutes} min efter. Inga inbjudningar skickade.`}),signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw new Error("Bokningsresultatet är osäkert. Tryck kontrollera igen; ingen ny bokning skapas.");
  const {error:save}=await db.from("calendar_holds").update({status:"confirmed"}).eq("id",h.id).eq("owner_id",owner);
  if(save) throw new Error("Bokningen finns hos Google men status kunde inte sparas. Kontrollera igen.");
}
