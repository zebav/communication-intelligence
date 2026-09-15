import { z } from "zod";
import type {SupabaseClient} from "@supabase/supabase-js";
import {calendarToken,syncCalendar} from "./service";
import {normalizeGoogleEvent} from "./google-calendar";
export const eventActionRequest=z.object({sourceId:z.string().uuid(),eventId:z.string().min(1).max(2000),kind:z.enum(["rename","cancel"]),newTitle:z.string().trim().min(1).max(300).optional()});
export type EventActionRequest=z.infer<typeof eventActionRequest>;
const editableEvent=z.object({id:z.string(),etag:z.string().min(1),status:z.string().optional(),summary:z.string().optional(),attendees:z.array(z.unknown()).optional(),recurrence:z.array(z.string()).optional(),recurringEventId:z.string().optional(),extendedProperties:z.object({private:z.record(z.string(),z.string()).optional()}).optional()}).passthrough();
export function validateEditableEvent(raw:unknown) {
 const event=editableEvent.parse(raw);
 if(event.status==="cancelled"||event.attendees?.length||event.recurrence?.length||event.recurringEventId)throw new Error("Bokningar med deltagare eller återkommande serier måste tills vidare hanteras i Google Kalender.");
 return event;
}
async function context(db:SupabaseClient,owner:string,sourceId:string,eventId:string) {
 const {data:source,error}=await db.from("calendar_sources").select("*").eq("owner_id",owner).eq("id",sourceId).eq("is_master",true).single();
 if(error||!source)throw new Error("Endast bokningar i din masterkalender kan ändras här.");
 const {account,token}=await calendarToken(db,owner,source.account_id);
 if(account.provider!=="google")throw new Error("Masterkalendern måste vara en Google-kalender.");
 const endpoint=`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(source.external_id)}/events/${encodeURIComponent(eventId)}`;
 return {source,endpoint,headers:{authorization:`Bearer ${token}`}};
}
export async function prepareEventAction(db:SupabaseClient,owner:string,input:EventActionRequest) {
 if(input.kind==="rename"&&!input.newTitle)throw new Error("Ange den nya rubriken.");
 const c=await context(db,owner,input.sourceId,input.eventId);
 const response=await fetch(c.endpoint,{headers:c.headers,cache:"no-store",signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error("Bokningen kunde inte hämtas för granskning.");
 const event=validateEditableEvent(await response.json());
 const before=normalizeGoogleEvent(event,c.source.external_id,c.source.timezone);
 const {data:plan,error}=await db.from("calendar_event_actions").insert({owner_id:owner,source_id:input.sourceId,event_id:input.eventId,kind:input.kind,new_title:input.kind==="rename"?input.newTitle:null,expected_etag:event.etag,before_event:before}).select("*").single();
 if(error||!plan)throw new Error("Förslaget kunde inte sparas. Inget har ändrats i kalendern.");
 return plan;
}
export async function executeEventAction(db:SupabaseClient,owner:string,planId:string) {
 const {data:plan,error}=await db.from("calendar_event_actions").select("*").eq("owner_id",owner).eq("id",planId).single();
 if(error||!plan)throw new Error("Åtgärdsförslaget finns inte.");
 if(plan.status==="completed")return {completed:true};
 if(plan.status==="stale")throw new Error("Förslaget gäller inte längre. Granska bokningen igen.");
 const c=await context(db,owner,plan.source_id,plan.event_id);
 const response=await fetch(c.endpoint,{headers:c.headers,cache:"no-store",signal:AbortSignal.timeout(10000)});
 let applied=false;
 const gone=response.status===404||response.status===410;
 const raw=response.ok?await response.json():null;
 if(plan.status==="executing") {
  applied=plan.kind==="cancel"?(gone||raw?.status==="cancelled"):
   Boolean(raw&&raw.status!=="cancelled"&&raw.extendedProperties?.private?.ciActionId===plan.id&&raw.summary===plan.new_title);
  if(!applied)throw new Error("Ett tidigare försök har osäkert resultat. Inget nytt ändringsanrop skickas. Kontrollera Google Kalender.");
 } else {
  if(!response.ok||Date.parse(plan.expires_at)<=Date.now()||raw?.etag!==plan.expected_etag) {
   await db.from("calendar_event_actions").update({status:"stale"}).eq("id",plan.id).eq("owner_id",owner).eq("status","proposed");
   throw new Error("Bokningen har ändrats eller förslaget har gått ut. Granska den igen.");
  }
  const event=validateEditableEvent(raw);
  const {data:claimed,error:claim}=await db.from("calendar_event_actions").update({status:"executing",approved_at:new Date().toISOString()}).eq("id",plan.id).eq("owner_id",owner).eq("status","proposed").select("id").maybeSingle();
  if(claim||!claimed)throw new Error("En ändring pågår redan. Uppdatera och kontrollera resultatet.");
  const result=await fetch(c.endpoint+"?sendUpdates=none",{method:plan.kind==="cancel"?"DELETE":"PATCH",headers:{...c.headers,"If-Match":plan.expected_etag,"content-type":"application/json"},
    ...(plan.kind==="rename"?{body:JSON.stringify({summary:plan.new_title,extendedProperties:{private:{...event.extendedProperties?.private,ciActionId:plan.id}}})}:{}),signal:AbortSignal.timeout(10000)});
  if(result.status===412) {
   await db.from("calendar_event_actions").update({status:"stale"}).eq("id",plan.id).eq("owner_id",owner);
   throw new Error("Någon ändrade bokningen samtidigt. Din ändring har inte skrivits över den.");
  }
  if(!result.ok)throw new Error("Resultatet är osäkert. Kontrollera åtgärden igen; inget dubbelt ändringsanrop skickas.");
  applied=true;
 }
 if(applied) {
  const {error:save}=await db.from("calendar_event_actions").update({status:"completed",completed_at:new Date().toISOString()}).eq("owner_id",owner).eq("id",plan.id);
  if(save)throw new Error("Åtgärden är utförd hos Google men kvittot kunde inte sparas. Kontrollera igen.");
 }
 try {await syncCalendar(db,owner,c.source.id,{start:new Date(Date.now()-7*86400000).toISOString(),end:new Date(Date.now()+60*86400000).toISOString()});}
 catch {return {completed:true,warning:"Åtgärden är utförd. Kalenderbilden kunde inte uppdateras; synkronisera igen."};}
 return {completed:true};
}
