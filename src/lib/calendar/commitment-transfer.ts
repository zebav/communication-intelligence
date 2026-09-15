import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calendarToken,syncCalendar } from "./service";
import { reviewCommitments } from "./reconciliation";
import type { CalendarEvent } from "./types";
import { transferFingerprint, transferPayload } from "./transfer-format";

export function transferEventId(owner:string,source:string,event:string) {
  // Google event IDs allow base32hex characters; hex is a valid subset.
  return "ci"+createHash("sha256").update(JSON.stringify([owner,source,event])).digest("hex");
}
/** Explicitly approved one-off copy. Never modifies the source event or sends attendees. */
export async function transferCommitment(db:SupabaseClient,owner:string,sourceId:string,eventId:string,expectedFingerprint:string) {
  const {data:master,error:masterError}=await db.from("calendar_sources").select("*").eq("owner_id",owner).eq("is_master",true).single();
  if(masterError||!master||master.id===sourceId)throw new Error("Välj en extern bokning och en befintlig masterkalender.");
  const range={start:new Date(Date.now()-7*86400000).toISOString(),end:new Date(Date.now()+60*86400000).toISOString()};
  await syncCalendar(db,owner,sourceId,range);
  await syncCalendar(db,owner,master.id,range);
  const {data:sources,error}=await db.from("calendar_sources").select("*").eq("owner_id",owner).in("id",[sourceId,master.id]);
  if(error||sources?.length!==2)throw new Error("Kalenderunderlaget kunde inte kontrolleras.");
  const source=sources.find(s=>s.id===sourceId),currentMaster=sources.find(s=>s.id===master.id);
  const event=(source.snapshot as CalendarEvent[]).find(e=>e.id===eventId);
  if(!event||event.status==="cancelled"||transferFingerprint(event)!==expectedFingerprint)throw new Error("Originalbokningen har ändrats. Uppdatera och granska igen.");
  if(Date.parse(event.start)<=Date.now())throw new Error("Endast framtida åtaganden kan föras över här.");
  const id=transferEventId(owner,sourceId,eventId);
  const {data:previous,error:read}=await db.from("calendar_commitment_transfers").select("*").eq("owner_id",owner).eq("source_id",sourceId).eq("source_event_id",eventId).maybeSingle();
  if(read)throw new Error("Överföringshistoriken kunde inte läsas.");
  if(previous&&transferFingerprint(previous.event_snapshot)!==expectedFingerprint)throw new Error("Bokningen har redan överförts med annat innehåll. Granska ändringen i master; ingen ny kopia skapas.");
  const {token}=await calendarToken(db,owner,master.account_id);
  const endpoint=`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(master.external_id)}/events`;
  const lookup=await fetch(endpoint+"/"+id,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});
  if(lookup.ok) {
    const found=await lookup.json();
    const payload=transferPayload(event,id,previous?.id??"");
    if(!previous||found.status==="cancelled"||found.extendedProperties?.private?.transferId!==previous.id||found.summary!==payload.summary
      || (event.allDay ? found.start?.date!==payload.start.date||found.end?.date!==payload.end.date : Date.parse(found.start?.dateTime)!==Date.parse(event.start)||Date.parse(found.end?.dateTime)!==Date.parse(event.end)))
      throw new Error("Masterbokningen har ändrats eller kunde inte verifieras. Ingen ny kopia skapas.");
    const {error:save}=await db.from("calendar_commitment_transfers").update({status:"confirmed",confirmed_at:new Date().toISOString()}).eq("id",previous.id).eq("owner_id",owner);
    if(save)throw new Error("Bokningen finns hos Google men bekräftelsen kunde inte sparas.");
    return;
  }
  if(lookup.status!==404)throw new Error("Masterbokningen kunde inte kontrolleras. Försök senare.");
  if(previous?.status==="executing"||previous?.status==="confirmed")throw new Error("Tidigare överföring behöver kontrolleras hos Google. Ingen ny bokning skapas.");
  const review=reviewCommitments([event],currentMaster.snapshot)[0];
  if(review.status!=="missing")throw new Error(review.status==="matched"?"Motsvarande bokning finns redan i master. Ingen kopia skapades.":"Tiden överlappar en masterbokning eller är en informationspost. Granska först.");
  const {data:holds,error:holdError}=await db.from("calendar_holds").select("*").eq("owner_id",owner).neq("status","released").gt("ends_at",event.start);
  if(holdError)throw new Error("Reservationer kunde inte kontrolleras.");
  if(holds.some(h=>(h.status!=="active"||Date.parse(h.expires_at)>Date.now())&&Date.parse(h.starts_at)-h.preparation_minutes*60000<Date.parse(event.end)&&Date.parse(h.ends_at)+h.recovery_minutes*60000>Date.parse(event.start)))throw new Error("Åtagandet överlappar en reservation. Släpp eller hantera reservationen först.");
  const {data:record,error:insert}=await db.from("calendar_commitment_transfers").upsert({owner_id:owner,source_id:sourceId,source_event_id:eventId,master_source_id:master.id,master_event_id:id,event_snapshot:event},{onConflict:"owner_id,source_id,source_event_id",ignoreDuplicates:true}).select("*").maybeSingle();
  if(insert)throw new Error("Godkännandet kunde inte sparas.");
  const transfer=record??previous;
  if(!transfer)throw new Error("En annan överföring pågår. Uppdatera vyn.");
  const {data:claim,error:claimError}=await db.from("calendar_commitment_transfers").update({status:"executing"}).eq("owner_id",owner).eq("id",transfer.id).eq("status","pending").select("id").maybeSingle();
  if(claimError||!claim)throw new Error("Överföringen pågår redan. Uppdatera och kontrollera status.");
  const response=await fetch(endpoint+"?sendUpdates=none",{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify(transferPayload(event,id,transfer.id)),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error("Överföringens resultat är osäkert. Kontrollera igen; samma boknings-ID används.");
  const {error:confirmed}=await db.from("calendar_commitment_transfers").update({status:"confirmed",confirmed_at:new Date().toISOString()}).eq("owner_id",owner).eq("id",transfer.id);
  if(confirmed)throw new Error("Bokningen skapades men kvittot kunde inte sparas. Kontrollera igen.");
  await syncCalendar(db,owner,master.id,range);
}
