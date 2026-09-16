"use client";
import {useEffect,useState,useRef} from "react";
import type {CalendarEvent} from "@/lib/calendar/types";
import type {SchedulingCandidate} from "@/lib/calendar/scheduling";
import {CalendarEventContext} from "./calendar-event-context";
import {CalendarTravelFields,emptyTravel,travelInput} from "./calendar-meeting-composer";
import {zonedInstant} from "@/lib/calendar/time";
import type {MeetingDetails} from "@/lib/calendar/meeting-details";
type Plan={id:string;kind:"rename"|"cancel"|"move"|"details";status:string;new_title:string|null;target_start:string|null;target_end:string|null;expires_at:string;before_event:{title:string;start:string;end:string;timezone:string};details?:{recipients:string[];edit?:{title:string;description:string;attendees:string[]};physical?:MeetingDetails}};
export function CalendarEventActions({sourceId,event,onDone,onClose}:{sourceId:string;event:CalendarEvent;onDone:()=>Promise<void>;onClose:()=>void}) {
 const [kind,setKind]=useState<Plan["kind"]>("details"),[title,setTitle]=useState(event.title),[plan,setPlan]=useState<Plan|null>(null);
 const [description,setDescription]=useState(event.description??""),[attendees,setAttendees]=useState((event.attendees??[]).map(a=>a.email).filter(Boolean).join("\n")),[approved,setApproved]=useState(false);
 const [physical,setPhysical]=useState(Boolean(event.location)),[travel,setTravel]=useState(emptyTravel),[start,setStart]=useState(""),[end,setEnd]=useState(""),[location,setLocation]=useState(event.location??"");
 const panel=useRef<HTMLElement>(null);
 const [saved,setSaved]=useState<Plan[]>([]),[ready,setReady]=useState(false),[date,setDate]=useState(""),[slots,setSlots]=useState<SchedulingCandidate[]>([]),[slot,setSlot]=useState<SchedulingCandidate|null>(null),[noTravel,setNoTravel]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[completed,setCompleted]=useState(false);
 const fmt=(value:string)=>new Date(value).toLocaleString("sv-SE",{timeZone:event.timezone,dateStyle:"medium",timeStyle:"short"});
 useEffect(()=>{
  panel.current?.scrollIntoView({behavior:"smooth",block:"start"});panel.current?.focus({preventScroll:true});
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
   if(data.plan){setPlan(data.plan);setSaved([data.plan]);setApproved(false);}
   if(data.dismissed){setSaved(saved.filter(p=>p.id!==body.planId));setPlan(null);await onDone();}
   if(data.completed){setCompleted(true);setSaved([]);setNotice(data.warning||(data.notificationsRequested?"Ändringen är genomförd. Google har tagit emot utskicket till deltagarna; leverans kan inte bekräftas här.":"Ändringen är genomförd i masterkalendern."));await onDone();}
  }catch(e){setError(e instanceof Error?e.message:"Kalenderfel");}finally{setBusy(false);}
 };
 const prepare=()=>{try {
  const move=kind!=="move"?{}:physical?{targetStart:zonedInstant(start,event.timezone),targetEnd:zonedInstant(end,event.timezone),travel:travelInput(travel,zonedInstant(start,event.timezone),zonedInstant(end,event.timezone),event.timezone),locationLabel:location}:{targetStart:slot?.start,targetEnd:slot?.end,noTravelRequired:noTravel};
  void run({action:"prepare",request:{sourceId,eventId:event.id,kind,...(kind==="details"?{details:{title,description,attendees:attendees.split(/[;,\n]+/).map(s=>s.trim()).filter(Boolean)}}:{}),...(kind==="rename"?{newTitle:title}:{}),...(kind==="move"?move:{})}});
 }catch(e){setError(e instanceof Error?e.message:"Kontrollera tider och platser.");}};
 return <section ref={panel} tabIndex={-1} className="calendar-panel calendar-approval" aria-label="Ändra masterbokning">
  <div className="calendar-actions"><h2>Hantera masterbokning</h2><button className="btn" disabled={busy} onClick={onClose}>Stäng</button></div><h3>{event.title}</h3>
  <p>{fmt(event.start)} – {fmt(event.end)} · {event.timezone}</p>
  <CalendarEventContext key={`${sourceId}:${event.id}`} sourceId={sourceId} eventId={event.id}/>
  <p>Redigera en enstaka masterbokning. Alla ändringar granskas före genomförande. Original i andra kalendrar ändras inte.</p>
  {error&&<p role="alert" className="calendar-notice error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!completed&&!plan&&saved.length>0&&<div><h3>Sparade åtgärder att granska</h3>{saved.map(p=><button className="btn" key={p.id} disabled={busy} onClick={()=>{setPlan(p);setKind(p.kind);}}>{p.status==="executing"?"Kontrollera tidigare försök":p.kind==="move"?"Granska sparad flytt":"Granska sparad ändring"}</button>)}</div>}
  {!completed&&!plan&&saved.length===0&&<div className="calendar-form">
   <label>Åtgärd<select value={kind} disabled={busy||!ready} onChange={e=>{setKind(e.target.value as Plan["kind"]);setSlot(null);}}><option value="details">Redigera rubrik, beskrivning och deltagare</option><option value="move">Ändra tid och planera resa</option><option value="cancel">Avboka i masterkalendern</option></select></label>
   {kind==="details"&&<><label>Rubrik<input value={title} maxLength={300} onChange={e=>setTitle(e.target.value)}/></label><label>Beskrivning till deltagarna<textarea value={description} maxLength={8000} onChange={e=>setDescription(e.target.value)}/></label><label>Deltagarnas e-post (en per rad)<textarea value={attendees} onChange={e=>setAttendees(e.target.value)}/></label><p>Tidigare och nya deltagare visas i utskicksgranskningen. Borttagna deltagare kan få avbokningsbesked från Google.</p></>}
   {kind==="rename"&&<label>Ny rubrik<input value={title} maxLength={300} disabled={busy} onChange={e=>setTitle(e.target.value)}/></label>}
   {kind==="move"&&<><p>Den gamla tiden ligger kvar som upptagen tills flytten lyckats. Välj en ny tid som inte överlappar den gamla.</p><label><input type="checkbox" checked={physical} onChange={e=>setPhysical(e.target.checked)}/> Fysiskt möte med reseplanering</label>
    {physical?<><label>Ny start ({event.timezone})<input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label><label>Nytt slut<input type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)}/></label><label>Plats/adress i inbjudan<input value={location} maxLength={500} onChange={e=>setLocation(e.target.value)}/></label><CalendarTravelFields value={travel} onChange={setTravel} timezone={event.timezone} disabled={busy}/></>:<>
    <label>Ny dag<input type="date" value={date} onChange={e=>{setDate(e.target.value);setSlots([]);setSlot(null);}}/></label>
    <label><input type="checkbox" checked={noTravel} onChange={e=>setNoTravel(e.target.checked)}/> Jag bekräftar att bokningen inte kräver någon resa.</label>
    <button className="btn" disabled={busy||!date||!noTravel||Boolean(event.location)||event.allDay} onClick={()=>run({action:"suggest",date,duration:(Date.parse(event.end)-Date.parse(event.start))/60000,preparation:0,recovery:0,physical:false},"/api/calendar")}>Hitta lediga tider</button>
    {slots.map(s=><button className={`btn ${slot?.start===s.start?"primary":""}`} key={s.start} disabled={busy||!s.bookable} onClick={()=>setSlot(s)}>{fmt(s.start)} – {fmt(s.end)}{!s.bookable?" · kräver synk/avstämning":""}</button>)}
    {event.location&&<p>Välj fysisk reseplanering eftersom bokningen har en plats.</p>}</>}
    {event.allDay&&<p>Heldagar ändras i originalkalendern.</p>}
   </>}
   <button className="btn" disabled={!ready||busy||((kind==="rename"||kind==="details")&&!title.trim())||(kind==="move"&&(event.allDay||(physical?(!start||!end||!location.trim()):(!slot||!noTravel))))} onClick={prepare}>Granska innan något ändras</button>
  </div>}
  {!completed&&plan&&<><h3>Godkänn denna åtgärd</h3><p>{plan.before_event.title}<br/>{fmt(plan.before_event.start)} – {fmt(plan.before_event.end)}</p>
   <p>{plan.kind==="cancel"?"Bokningen tas bort från masterkalendern. Åtgärden återställs inte automatiskt.":plan.kind==="move"?`Ny tid: ${fmt(plan.target_start!)} – ${fmt(plan.target_end!)}`:`Ny rubrik: ${plan.details?.edit?.title??plan.new_title}`}</p>
   {plan.details?.edit&&<><p style={{whiteSpace:"pre-wrap"}}>{plan.details.edit.description}</p><p>Deltagare efter ändringen: {plan.details.edit.attendees.join(", ")||"Inga"}</p></>}
   {plan.details?.physical&&<p>Plats: {plan.details.physical.locationLabel}. Reseplanen kontrolleras på nytt före ändringen.</p>}
   {Boolean(plan.details?.recipients.length)&&<><h4>Utskick till följande adresser</h4><ul>{plan.details!.recipients.map(email=><li key={email}>{email}</li>)}</ul><label><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)}/> Jag godkänner kalenderuppdateringen/inbjudan till dessa mottagare.</label></>}
   <p>Underlaget kontrolleras på nytt hos Google före ändringen. Ett oklart resultat kontrolleras utan ett nytt utskick.</p>
   <div className="calendar-actions"><button className="btn primary" disabled={busy||(Boolean(plan.details?.recipients.length)&&!approved)} onClick={()=>run({action:"execute",planId:plan.id,approved:true,approvedNotifications:approved})}>{busy?"Kontrollerar…":"Godkänn / kontrollera resultat"}</button>
   {plan.status!=="executing"&&<button className="btn" disabled={busy} onClick={()=>run({action:"dismiss",planId:plan.id})}>Avstå och släpp förslaget</button>}</div>
  </>}
 </section>;
}
