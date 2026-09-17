import type {CalendarEvent} from "./types";
import {transferFingerprint} from "./transfer-format";

/** Reuses the single-event approval endpoint; never retries an uncertain write. */
export async function transferBatch(sourceId:string,events:CalendarEvent[],progress:(done:number,total:number,title:string)=>void,transport:typeof fetch=fetch){
 let completed=0;
 for(const event of events){
  progress(completed,events.length,event.title);
  try{
   const response=await transport("/api/calendar",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"transfer",sourceId,eventId:event.id,fingerprint:transferFingerprint(event),approved:true}),signal:AbortSignal.timeout(65000)});
   const result=await response.json();
   if(!response.ok)throw new Error(result.error||"Överföringen kunde inte bekräftas.");
   completed++;
  }catch(e){throw new Error(`${completed} av ${events.length} bekräftade. Stopp vid ”${event.title}”: ${e instanceof Error?e.message:"Okänt resultat."} Kontrollera den posten innan du fortsätter. Senare poster har inte behandlats.`);}
 }
 return completed;
}
