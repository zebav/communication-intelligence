/** Refresh enabled calendars through authenticated endpoints. Never approve reconciliation. */
export async function refreshBookingCalendars(progress:(message:string)=>void,transport:typeof fetch=fetch){
 const response=await transport("/api/calendar",{cache:"no-store",signal:AbortSignal.timeout(65000)});
 const data=await response.json();if(!response.ok)throw new Error(data.error||"Kalenderunderlaget kunde inte hämtas.");
 const sources=(data.sources as {id:string;name:string;enabled:boolean}[]).filter(s=>s.enabled);
 if(!sources.length)throw new Error("Ingen aktiv kalender finns.");
 for(let i=0;i<sources.length;i++){
  const source=sources[i];progress(`Hämtar aktuella bokningar ${i+1}/${sources.length}: ${source.name}`);
  const r=await transport("/api/calendar",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"sync",sourceId:source.id}),signal:AbortSignal.timeout(65000)});
  const result=await r.json();if(!r.ok)throw new Error(result.error||`Kalendern ${source.name} kunde inte uppdateras. Ingen ny bokning har skickats.`);
 }
 progress("Kontrollerar avstämning, tid och eventuella resor…");
}
