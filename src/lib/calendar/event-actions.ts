import { z } from "zod";
import type {SupabaseClient} from "@supabase/supabase-js";
import {calendarToken,syncCalendar} from "./service";
import {normalizeGoogleEvent} from "./google-calendar";
import {calendarSuggestions} from "./suggestions-service";
import {recipientsSchema,sameRecipients,meetingDetailsSchema,travelReservation} from "./meeting-details";
import {travelPlanRequest} from "./travel-plan";
import {calendarTravelAssessment} from "./travel-service";
import type {RouteService} from "./places-routing";
export const editDetailsSchema=z.object({title:z.string().trim().min(1).max(300),description:z.string().max(8000),attendees:recipientsSchema}).strict();
export const eventActionRequest=z.object({sourceId:z.string().uuid(),eventId:z.string().min(1).max(2000),kind:z.enum(["rename","cancel","move","details"]),details:editDetailsSchema.optional(),newTitle:z.string().trim().min(1).max(300).optional(),targetStart:z.iso.datetime({offset:true}).optional(),targetEnd:z.iso.datetime({offset:true}).optional(),noTravelRequired:z.literal(true).optional(),travel:travelPlanRequest.optional(),locationLabel:z.string().trim().min(1).max(500).optional()});
export type EventActionRequest=z.infer<typeof eventActionRequest>;
const editableEvent=z.object({id:z.string(),etag:z.string().min(1),status:z.string().optional(),summary:z.string().optional(),attendees:z.array(z.unknown()).optional(),recurrence:z.array(z.string()).optional(),recurringEventId:z.string().optional(),extendedProperties:z.object({private:z.record(z.string(),z.string()).optional()}).optional()}).passthrough();
export function validateEditableEvent(raw:unknown,allowAttendees=false) {
 const event=editableEvent.parse(raw);
 if(event.status==="cancelled"||(!allowAttendees&&event.attendees?.length)||event.recurrence?.length||event.recurringEventId)throw new Error("Återkommande serier och avbokade möten hanteras tills vidare i originalkalendern.");
 const ownership=z.object({organizer:z.object({self:z.boolean().optional()}).optional(),attendeesOmitted:z.boolean().optional()}).parse(raw);
 if(ownership.organizer?.self===false||ownership.attendeesOmitted)throw new Error("Mötet tillhör en annan organisatör eller deltagarlistan är ofullständig.");
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
async function checkMove(db:SupabaseClient,owner:string,start:string,end:string,holdId?:string) {
 const {data:settings,error}=await db.from("calendar_workspace").select("timezone").eq("owner_id",owner).single();
 if(error||!settings)throw new Error("Kalenderns tidszon kunde inte läsas.");
 const duration=(Date.parse(end)-Date.parse(start))/60000;
 if(!Number.isInteger(duration)||duration<5||duration>600)throw new Error("Välj en giltig möteslängd mellan 5 och 600 minuter.");
 const date=new Intl.DateTimeFormat("sv-SE",{timeZone:settings.timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(start));
 const checked=await calendarSuggestions(db,owner,{date,duration,preparation:0,recovery:0,physical:false,requestedStart:start},holdId);
 if(!checked.slots.some(s=>s.bookable&&Date.parse(s.start)===Date.parse(start)&&Date.parse(s.end)===Date.parse(end)))throw new Error("Den nya tiden är inte ledig enligt synkronisering, avstämning och planeringsregler. Välj ett nytt tidsförslag.");
 return checked;
}
const freshRange=()=>({start:new Date(Date.now()-7*86400000).toISOString(),end:new Date(Date.now()+60*86400000).toISOString()});
async function assertMoveContext(db:SupabaseClient,owner:string,sourceId:string,eventId:string) {
 const {data,error}=await db.from("calendar_event_context").select("location_kind").eq("owner_id",owner).eq("source_id",sourceId).eq("event_id",eventId).maybeSingle();
 if(error)throw new Error("Bokningens platskoppling kunde inte kontrolleras.");
 if(data?.location_kind==="physical")throw new Error("Bokningen är kopplad till en fysisk plats. Resan måste planeras före flytt.");
}
export async function prepareEventAction(db:SupabaseClient,owner:string,input:EventActionRequest,routes?:RouteService) {
 if(input.kind==="rename"&&!input.newTitle)throw new Error("Ange den nya rubriken.");
 const c=await context(db,owner,input.sourceId,input.eventId);
 const response=await fetch(c.endpoint,{headers:c.headers,cache:"no-store",signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error("Bokningen kunde inte hämtas för granskning.");
 const event=validateEditableEvent(await response.json(),true);
 const oldRecipients=recipientsSchema.parse((event.attendees??[]).map(a=>z.object({email:z.string()}).parse(a).email));
 if(input.kind==="details"&&!input.details)throw new Error("Ange rubrik, beskrivning och deltagare.");
 const recipients=[...new Set([...oldRecipients,...(input.details?.attendees??[])])].sort();
 const before=normalizeGoogleEvent(event,c.source.external_id,c.source.timezone);
 let holdId:string|null=null;
 const physical=input.travel?meetingDetailsSchema.parse({travel:input.travel,locationLabel:input.locationLabel}):null;
 if(input.kind==="move") {
  if(!input.targetStart||!input.targetEnd||(!physical&&!input.noTravelRequired))throw new Error("Välj ny tid och ange om resa krävs.");
  if(before.allDay)throw new Error("Heldagar redigeras i originalkalendern.");
  if(!physical){await assertMoveContext(db,owner,input.sourceId,input.eventId);if(before.location?.trim())throw new Error("Bokningen har en plats. Planera resan innan den flyttas.");}
  await syncCalendar(db,owner,c.source.id,freshRange());
  const checked=await checkMove(db,owner,input.targetStart,input.targetEnd);
  let preparation=checked.preparation,recovery=checked.recovery;
  if(physical){
   if(!routes)throw new Error("Restidstjänsten är inte aktiverad.");
   const reservation=travelReservation(physical,input.targetStart,input.targetEnd)!;
   const assessment=await calendarTravelAssessment(db,owner,physical.travel!,routes);
   if(assessment.status!=="FEASIBLE")throw new Error("Resan ryms inte eller kalenderunderlaget behöver uppdateras. Inget har flyttats.");
   preparation=reservation.preparation;recovery=reservation.recovery;
  }
  const {data:hold,error:reserve}=await db.from("calendar_holds").insert({owner_id:owner,purpose:"move",title:before.title,starts_at:input.targetStart,ends_at:input.targetEnd,preparation_minutes:preparation,recovery_minutes:recovery,meeting_details:physical}).select("id").single();
  if(reserve||!hold)throw new Error("Den nya tiden kunde inte reserveras. Inget har flyttats.");
  holdId=hold.id;
 }
 const {data:plan,error}=await db.from("calendar_event_actions").insert({owner_id:owner,source_id:input.sourceId,event_id:input.eventId,kind:input.kind,new_title:input.kind==="rename"?input.newTitle:null,expected_etag:event.etag,before_event:before,details:{recipients,...(physical?{physical}:{}),...(input.kind==="details"?{edit:input.details}:{})},hold_id:holdId,target_start:input.kind==="move"?input.targetStart:null,target_end:input.kind==="move"?input.targetEnd:null}).select("*").single();
 if(error||!plan){if(holdId)await db.from("calendar_holds").update({status:"released"}).eq("owner_id",owner).eq("id",holdId).eq("status","active");throw new Error("Förslaget kunde inte sparas. Inget har ändrats i kalendern.");}
 return plan;
}
export async function executeEventAction(db:SupabaseClient,owner:string,planId:string,approvedNotifications=false,routes?:RouteService) {
 const {data:plan,error}=await db.from("calendar_event_actions").select("*").eq("owner_id",owner).eq("id",planId).single();
 if(error||!plan)throw new Error("Åtgärdsförslaget finns inte.");
 if(plan.status==="completed")return {completed:true};
 if(plan.status==="stale")throw new Error("Förslaget gäller inte längre. Granska bokningen igen.");
 const recipients=recipientsSchema.parse(plan.details?.recipients??[]);
 const edit=plan.kind==="details"?editDetailsSchema.parse(plan.details?.edit):null;
 const physical=plan.details?.physical?meetingDetailsSchema.parse(plan.details.physical):null;
 if(recipients.length&&!approvedNotifications)throw new Error("Godkänn utskick till de visade deltagarna innan ändringen genomförs.");
 const c=await context(db,owner,plan.source_id,plan.event_id);
 const response=await fetch(c.endpoint,{headers:c.headers,cache:"no-store",signal:AbortSignal.timeout(10000)});
 let applied=false;
 const gone=response.status===404||response.status===410;
 const raw=response.ok?await response.json():null;
 if(plan.status==="executing") {
  applied=plan.kind==="cancel"?(gone||raw?.status==="cancelled"):
   Boolean(raw&&raw.status!=="cancelled"&&raw.extendedProperties?.private?.ciActionId===plan.id&&(plan.kind==="move"?
    Date.parse(raw.start?.dateTime)===Date.parse(plan.target_start)&&Date.parse(raw.end?.dateTime)===Date.parse(plan.target_end)&&(!physical||raw.location===physical.locationLabel):edit?raw.summary===edit.title&&(raw.description??"")===edit.description&&sameRecipients(raw.attendees,edit.attendees):raw.summary===plan.new_title));
  if(!applied)throw new Error("Ett tidigare försök har osäkert resultat. Inget nytt ändringsanrop skickas. Kontrollera Google Kalender.");
 } else {
  if(!response.ok||Date.parse(plan.expires_at)<=Date.now()||raw?.etag!==plan.expected_etag) {
   await db.from("calendar_event_actions").update({status:"stale"}).eq("id",plan.id).eq("owner_id",owner).eq("status","proposed");
   throw new Error("Bokningen har ändrats eller förslaget har gått ut. Granska den igen.");
  }
  const event=validateEditableEvent(raw,Boolean(plan.details));
  const expectedRecipients=[...new Set([...recipientsSchema.parse((event.attendees??[]).map(a=>z.object({email:z.string()}).parse(a).email)),...(edit?.attendees??[])])].sort();
  if(JSON.stringify(expectedRecipients)!==JSON.stringify(recipients))throw new Error("Deltagarlistan stämmer inte med det granskade utskicket. Skapa ett nytt förslag.");
  if(plan.kind==="move") {
   if(!physical)await assertMoveContext(db,owner,plan.source_id,plan.event_id);
   await syncCalendar(db,owner,c.source.id,freshRange());
   await checkMove(db,owner,plan.target_start,plan.target_end,plan.hold_id);
   if(physical){
    if(!routes)throw new Error("Restidstjänsten är inte aktiverad.");
    const reservation=travelReservation(physical,plan.target_start,plan.target_end)!;
    const {data:hold,error:holdError}=await db.from("calendar_holds").select("*").eq("owner_id",owner).eq("id",plan.hold_id).single();
    if(holdError||!hold||hold.preparation_minutes!==reservation.preparation||hold.recovery_minutes!==reservation.recovery)throw new Error("Resereservationen stämmer inte med förslaget.");
    if((await calendarTravelAssessment(db,owner,physical.travel!,routes,plan.hold_id)).status!=="FEASIBLE")throw new Error("Resan ryms inte längre. Granska en ny tid.");
   }
  }
  const {data:claimed,error:claim}=await db.from("calendar_event_actions").update({status:"executing",approved_at:new Date().toISOString()}).eq("id",plan.id).eq("owner_id",owner).eq("status","proposed").select("id").maybeSingle();
  if(claim||!claimed)throw new Error("En ändring pågår redan. Uppdatera och kontrollera resultatet.");
  const result=await fetch(c.endpoint+`?sendUpdates=${recipients.length?"all":"none"}`,{method:plan.kind==="cancel"?"DELETE":"PATCH",headers:{...c.headers,"If-Match":plan.expected_etag,"content-type":"application/json"},
    ...(plan.kind!=="cancel"?{body:JSON.stringify({...(edit?{summary:edit.title,description:edit.description,attendees:edit.attendees.map(email=>({...((event.attendees??[]).find(a=>(a as {email?:string}).email?.toLowerCase()===email) as object??{}),email}))}:plan.kind==="rename"?{summary:plan.new_title}:{start:{dateTime:plan.target_start,timeZone:c.source.timezone},end:{dateTime:plan.target_end,timeZone:c.source.timezone},...(physical?{location:physical.locationLabel}:{})}),extendedProperties:{private:{...event.extendedProperties?.private,ciActionId:plan.id}}})}:{}),signal:AbortSignal.timeout(10000)});
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
 return {completed:true,...(recipients.length?{notificationsRequested:true}:{})};
}
