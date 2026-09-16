"use client";
import {useEffect,useState} from "react";
import type {CalendarEvent} from "@/lib/calendar/types";
import type {SchedulingCandidate} from "@/lib/calendar/scheduling";
import {CalendarEventContext} from "./calendar-event-context";
type Plan={id:string;kind:"rename"|"cancel"|"move";status:string;new_title:string|null;target_start:string|null;target_end:string|null;expires_at:string;before_event:{title:string;start:string;end:string;timezone:string}};
export function CalendarEventActions({sourceId,event,onDone,onClose}:{sourceId:string;event:CalendarEvent;onDone:()=>Promise<void>;onClose:()=>void}) {
 const [kind,setKind]=useState<Plan["kind"]>("rename"),[title,setTitle]=useState(event.title),[plan,setPlan]=useState<Plan|null>(null);
 const [saved,setSaved]=useState<Plan[]>([]),[ready,setReady]=useState(false),[date,setDate]=useState(""),[slots,setSlots]=useState<SchedulingCandidate[]>([]),[slot,setSlot]=useState<SchedulingCandidate|null>(null),[noTravel,setNoTravel]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[completed,setCompleted]=useState(false);
 const fmt=(value:string)=>new Date(value).toLocaleString("sv-SE",{timeZone:event.timezone,dateStyle:"medium",timeStyle:"short"});
 useEffect(()=>{
  const controller=new AbortController();
  void fetch(`/api/calendar/actions?sourceId=${encodeURIComponent(sourceId)}&eventId=${encodeURIComponent(event.id)}`,{cache:"no-store",signal:controller.signal}).then(async response=>{
   const data=await response.json();if(!response.ok)throw new Error(data.error);setSaved(data.plans);setReady(true);
  }).catch(e=>{if(e.name!=="AbortError")setError(e.message);});
  return()=>controller.abort();
 },[sourceId,event.id]);
 const run=async(body:Record<string,unknown>,endpoint="/api/calendar/actions")=>{
  setBusy(true);setError("");setNotice("");
  try {
   const response=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),data=await response.json();
   if(!response.ok)throw new Error(data.error||"Åtgärden kunde inte genomföras.");
   if(data.slots){setSlots(data.slots);setSlot(null);if(!data.slots.length)setNotice("Inga lediga tider enligt dina regler. Synkronisera kalendrarna eller välj en annan dag.");}
   if(data.plan){setPlan(data.plan);setSaved([data.plan]);}
   if(data.dismissed){setSaved(saved.filter(p=>p.id!==body.planId));setPlan(null);await onDone();}
   if(data.completed){setCompleted(true);setSaved([]);setNotice(data.warning||"Ändringen är genomförd i masterkalendern. Inga inbjudningar skickades.");await onDone();}
  }catch(e){setError(e instanceof Error?e.message:"Kalenderfel");}finally{setBusy(false);}
 };
 return <section className="calendar-panel calendar-approval" aria-label="Ändra masterbokning">
  <div className="calendar-actions"><h2>Hantera masterbokning</h2><button className="btn" disabled={busy} onClick={onClose}>Stäng</button></div><h3>{event.title}</h3>
  <p>{fmt(event.start)} – {fmt(event.end)} · {event.timezone}</p>
  <CalendarEventContext key={`${sourceId}:${event.id}`} sourceId={sourceId} eventId={event.id}/>
  <p>Ändra rubrik, flytta eller avboka en enstaka bokning utan deltagare. Original i andra kalendrar ändras inte.</p>
  {error&&<p role="alert" className="calendar-notice error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!completed&&!plan&&saved.length>0&&<div><h3>Sparade åtgärder att granska</h3>{saved.map(p=><button className="btn" key={p.id} disabled={busy} onClick={()=>{setPlan(p);setKind(p.kind);}}>{p.status==="executing"?"Kontrollera tidigare försök":p.kind==="move"?"Granska sparad flytt":"Granska sparad ändring"}</button>)}</div>}
  {!completed&&!plan&&saved.length===0&&<div className="calendar-form">
   <label>Åtgärd<select value={kind} disabled={busy||!ready} onChange={e=>{setKind(e.target.value as Plan["kind"]);setSlot(null);}}><option value="rename">Ändra rubrik</option><option value="move">Flytta till ny tid</option><option value="cancel">Avboka i masterkalendern</option></select></label>
   {kind==="rename"&&<label>Ny rubrik<input value={title} maxLength={300} disabled={busy} onChange={e=>setTitle(e.target.value)}/></label>}
   {kind==="move"&&<><p>Flytt gäller just nu bokningar utan fysisk plats. Den gamla tiden ligger kvar som upptagen tills flytten lyckats.</p>
    <label>Ny dag<input type="date" value={date} onChange={e=>{setDate(e.target.value);setSlots([]);setSlot(null);}}/></label>
    <label><input type="checkbox" checked={noTravel} onChange={e=>setNoTravel(e.target.checked)}/> Jag bekräftar att bokningen inte kräver någon resa.</label>
    <button className="btn" disabled={busy||!date||!noTravel||Boolean(event.location)||event.allDay} onClick={()=>run({action:"suggest",date,duration:(Date.parse(event.end)-Date.parse(event.start))/60000,preparation:0,recovery:0,physical:false},"/api/calendar")}>Hitta lediga tider</button>
    {slots.map(s=><button className={`btn ${slot?.start===s.start?"primary":""}`} key={s.start} disabled={busy||!s.bookable} onClick={()=>setSlot(s)}>{fmt(s.start)} – {fmt(s.end)}{!s.bookable?" · kräver synk/avstämning":""}</button>)}
    {(event.location||event.allDay)&&<p>Denna bokning kräver separat plats-/heldagsplanering och kan inte flyttas här ännu.</p>}
   </>}
   <button className="btn" disabled={!ready||busy||(kind==="rename"&&!title.trim())||(kind==="move"&&(!slot||!noTravel))} onClick={()=>run({action:"prepare",request:{sourceId,eventId:event.id,kind,...(kind==="rename"?{newTitle:title}:{}),...(kind==="move"?{targetStart:slot!.start,targetEnd:slot!.end,noTravelRequired:noTravel}:{})}})}>Granska innan något ändras</button>
  </div>}
  {!completed&&plan&&<><h3>Godkänn denna åtgärd</h3><p>{plan.before_event.title}<br/>{fmt(plan.before_event.start)} – {fmt(plan.before_event.end)}</p>
   <p>{plan.kind==="cancel"?"Bokningen tas bort från masterkalendern. Åtgärden återställs inte automatiskt.":plan.kind==="move"?`Ny tid: ${fmt(plan.target_start!)} – ${fmt(plan.target_end!)}`:`Ny rubrik: ${plan.new_title}`}</p>
   <p>Ingen inbjudan eller meddelande skickas. Underlaget kontrolleras på nytt hos Google före ändringen.</p>
   <div className="calendar-actions"><button className="btn primary" disabled={busy} onClick={()=>run({action:"execute",planId:plan.id,approved:true})}>{busy?"Kontrollerar…":"Godkänn / kontrollera resultat"}</button>
   {plan.status!=="executing"&&<button className="btn" disabled={busy} onClick={()=>run({action:"dismiss",planId:plan.id})}>Avstå och släpp förslaget</button>}</div>
  </>}
 </section>;
}
