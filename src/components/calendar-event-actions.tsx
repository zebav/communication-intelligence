"use client";
import {useState} from "react";
import type {CalendarEvent} from "@/lib/calendar/types";
type Plan={id:string;kind:"rename"|"cancel";new_title:string|null;expires_at:string;before_event:{title:string;start:string;end:string;timezone:string}};
export function CalendarEventActions({sourceId,event,onDone,onClose}:{sourceId:string;event:CalendarEvent;onDone:()=>Promise<void>;onClose:()=>void}) {
 const [kind,setKind]=useState<"rename"|"cancel">("rename"),[title,setTitle]=useState(event.title),[plan,setPlan]=useState<Plan|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[completed,setCompleted]=useState(false);
 const run=async(body:Record<string,unknown>)=>{
  setBusy(true);setError("");setNotice("");
  try {
   const response=await fetch("/api/calendar/actions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),data=await response.json();
   if(!response.ok)throw new Error(data.error||"Åtgärden kunde inte genomföras.");
   if(data.plan)setPlan(data.plan);
   if(data.completed){setCompleted(true);setNotice(data.warning||(kind==="cancel"?"Masterbokningen är avbokad. Originalbokningar i andra kalendrar är oförändrade.":"Rubriken är ändrad i masterkalendern."));await onDone();}
  }catch(e){setError(e instanceof Error?e.message:"Kalenderfel");}finally{setBusy(false);}
 };
 return <section className="calendar-panel calendar-approval" aria-label="Ändra masterbokning"><div className="calendar-actions"><h2>Hantera masterbokning</h2><button className="btn" disabled={busy} onClick={onClose}>Stäng</button></div><h3>{event.title}</h3>
 <p>Här kan du ändra rubrik eller avboka en enstaka bokning utan deltagare. Flytt till annan tid och återkommande möten hanteras inte i detta flöde ännu.</p>
 {error&&<p role="alert" className="calendar-notice error">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {!completed&&!plan&&<div className="calendar-form"><label>Åtgärd<select value={kind} disabled={busy} onChange={e=>setKind(e.target.value as "rename"|"cancel")}><option value="rename">Ändra rubrik</option><option value="cancel">Avboka i masterkalendern</option></select></label>{kind==="rename"&&<label>Ny rubrik<input value={title} maxLength={300} disabled={busy} onChange={e=>setTitle(e.target.value)}/></label>}<button className="btn" disabled={busy||(kind==="rename"&&!title.trim())} onClick={()=>run({action:"prepare",request:{sourceId,eventId:event.id,kind,...(kind==="rename"?{newTitle:title}:{})}})}>Granska innan något ändras</button></div>}
 {!completed&&plan&&<><h3>Godkänn denna åtgärd</h3><p>{plan.before_event.title}<br/>{plan.before_event.start} – {plan.before_event.end} ({plan.before_event.timezone})</p><p>{plan.kind==="cancel"?"Bokningen tas bort från masterkalendern. Åtgärden återställs inte automatiskt.":`Ny rubrik: ${plan.new_title}`}</p><p>Ingen inbjudan eller meddelande skickas. Underlaget kontrolleras på nytt hos Google före ändringen.</p><div className="calendar-actions"><button className="btn primary" disabled={busy} onClick={()=>run({action:"execute",planId:plan.id,approved:true})}>{busy?"Kontrollerar…":"Godkänn / kontrollera resultat"}</button><button className="btn" disabled={busy} onClick={()=>setPlan(null)}>Tillbaka utan ny ändring</button></div></>}
 </section>;
}
