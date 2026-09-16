"use client";
import {useEffect,useState} from "react";
import {zonedInstant} from "@/lib/calendar/time";
import type {PlaceCandidate} from "@/lib/calendar/places-routing";
import type {MeetingDetails} from "@/lib/calendar/meeting-details";
import {meetingDetailsSchema} from "@/lib/calendar/meeting-details";

export type TravelDraft={origin:PlaceCandidate|null;meeting:PlaceCandidate|null;next:PlaceCandidate|null;departure:string;arrival:string;mode:"DRIVE"|"WALK"|"BICYCLE"|"TRANSIT"};
export const emptyTravel:TravelDraft={origin:null,meeting:null,next:null,departure:"",arrival:"",mode:"DRIVE"};
export function travelInput(d:TravelDraft,start:string,end:string,timezone:string) {
 if(!d.origin||!d.meeting||!d.next)throw new Error("Välj startplats, mötesplats och nästa plats.");
 return {start,end,availableFrom:zonedInstant(d.departure,timezone),availableUntil:zonedInstant(d.arrival,timezone),originPlaceId:d.origin.id,meetingPlaceId:d.meeting.id,nextPlaceId:d.next.id,mode:d.mode};
}
export function CalendarTravelFields({value,onChange,timezone,disabled}:{value:TravelDraft;onChange:(value:TravelDraft)=>void;timezone:string;disabled:boolean}) {
 const [query,setQuery]=useState(""),[places,setPlaces]=useState<PlaceCandidate[]>([]),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const search=async()=>{setBusy(true);setError("");try{const r=await fetch("/api/calendar/planning",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"places",query})});const data=await r.json();if(!r.ok)throw new Error(data.error);setPlaces(data.places);}catch(e){setError(e instanceof Error?e.message:"Platssökningen misslyckades");}finally{setBusy(false);}};
 return <fieldset disabled={disabled||busy}><legend>Resa till och från mötet</legend>
  <p>Välj var du är före mötet och vart du ska efteråt. Även återresa behöver planeras. Hela resefönstret hålls upptaget i systemet.</p>
  <label>Sök adress eller plats<input value={query} maxLength={300} onChange={e=>setQuery(e.target.value)}/></label><button className="btn" disabled={query.trim().length<3} onClick={search}>Sök plats</button>
  {error&&<p role="alert">{error}</p>}<p translate="no">Google Maps</p>
  {places.map(p=><article className="calendar-hold" key={p.id}><strong>{p.name}</strong><p>{p.address}</p><a href={p.mapsUrl} target="_blank" rel="noopener noreferrer">Visa plats</a><div className="calendar-actions">{([['origin','Startplats'],['meeting','Mötesplats'],['next','Nästa plats']] as const).map(([key,label])=><button key={key} className="btn" onClick={()=>onChange({...value,[key]:p})}>{label}</button>)}</div></article>)}
  <p>{value.origin?.name||"Välj start"} → {value.meeting?.name||"Välj mötesplats"} → {value.next?.name||"Välj nästa plats"}</p>
  <div className="calendar-form-grid"><label>Avresa från startplats ({timezone})<input type="datetime-local" value={value.departure} onChange={e=>onChange({...value,departure:e.target.value})}/></label><label>Senast framme på nästa plats<input type="datetime-local" value={value.arrival} onChange={e=>onChange({...value,arrival:e.target.value})}/></label><label>Färdsätt<select value={value.mode} onChange={e=>onChange({...value,mode:e.target.value as TravelDraft['mode']})}><option value="DRIVE">Bil</option><option value="WALK">Promenad</option><option value="BICYCLE">Cykel</option><option value="TRANSIT">Kollektivtrafik</option></select></label></div>
 </fieldset>;
}
type Review={id:string;title:string;starts_at:string;ends_at:string;expires_at:string;preparation_minutes:number;recovery_minutes:number;meeting_details:MeetingDetails};
export function CalendarMeetingComposer({timezone,onDone}:{timezone:string;onDone:()=>Promise<void>}) {
 const [title,setTitle]=useState(""),[description,setDescription]=useState(""),[attendees,setAttendees]=useState(""),[location,setLocation]=useState("");
 const [start,setStart]=useState(""),[end,setEnd]=useState(""),[physical,setPhysical]=useState(false),[travel,setTravel]=useState(emptyTravel);
 const [plan,setPlan]=useState<Review|null>(null),[approved,setApproved]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [travelReview,setTravelReview]=useState<{inboundMinutes:number;outboundMinutes:number}|null>(null);
 const [rules,setRules]=useState<{preparationMinutes:number;recoveryMinutes:number}|null>(null),[maps,setMaps]=useState(false);
 useEffect(()=>{const c=new AbortController();void fetch("/api/calendar/planning",{signal:c.signal,cache:"no-store"}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);setRules(d.rules);setMaps(d.mapsEnabled);}).catch(e=>{if(e.name!=="AbortError")setError(e.message);});return()=>c.abort();},[]);
 const run=async(action:"prepare"|"confirm"|"release")=>{
  setBusy(true);setError("");setNotice("");
  try {
   let body:Record<string,unknown>;
   if(action==="prepare") {
    if(!rules)throw new Error("Planeringsreglerna måste hämtas först.");
    const from=zonedInstant(start,timezone),to=zonedInstant(end,timezone);
    const details=meetingDetailsSchema.parse({description,attendees:attendees.split(/[;,\n]+/).map(s=>s.trim()).filter(Boolean),locationLabel:physical?location:"",travel:physical?travelInput(travel,from,to,timezone):null});
    body={action:"hold",title,start:from,end:to,preparation:rules.preparationMinutes,recovery:rules.recoveryMinutes,physical,conversationId:null,details};
   } else {if(!plan)throw new Error("Granska förslaget först.");body={action:action==="confirm"?"confirm":"release",holdId:plan.id,approved:true,approvedInvitations:approved};}
   const r=await fetch("/api/calendar",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),d=await r.json();if(!r.ok)throw new Error(d.error);
   if(action==="prepare"){setPlan(d.hold);setApproved(false);setTravelReview(d.travelReview??null);}
   else {setNotice(d.warning||(action==="release"?"Reservationen är släppt.":plan!.meeting_details.attendees.length?"Mötet är skapat och Google har tagit emot utskicket. Leverans till mottagarnas inkorgar kan inte bekräftas här.":"Mötet är skapat utan inbjudningar."));setPlan(null);if(action==="confirm"){setTitle("");setAttendees("");}}
   await onDone();
  }catch(e){setError(e instanceof Error?e.message:"Kontrollera mötesuppgifterna.");}finally{setBusy(false);}
 };
 return <details className="calendar-panel"><summary>Nytt möte · plats, resa och inbjudningar</summary>
  <p>Först kontrolleras tiden och reserveras preliminärt. Bokning och utskick kräver ett separat godkännande.</p>
  {error&&<p role="alert" className="calendar-notice error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!plan?<fieldset disabled={busy||!rules} className="calendar-form"><legend>Mötesuppgifter</legend>
   <label>Rubrik<input value={title} maxLength={300} onChange={e=>setTitle(e.target.value)}/></label>
   <div className="calendar-form-grid"><label>Start ({timezone})<input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label><label>Slut<input type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)}/></label></div>
   <label>Beskrivning till deltagarna<textarea value={description} maxLength={8000} onChange={e=>setDescription(e.target.value)}/></label>
   <label>Deltagarnas e-postadresser (en per rad)<textarea value={attendees} onChange={e=>setAttendees(e.target.value)} placeholder="Lämna tomt för en privat bokning"/></label>
   <label><input type="checkbox" checked={physical} onChange={e=>setPhysical(e.target.checked)}/> Fysiskt möte med resa</label>
   {physical&&<>{!maps&&<p role="status">Restidstjänsten är inte aktiverad ännu. Fysiska bokningar kan inte godkännas utan verifierad restid.</p>}<label>Plats/adress som ska stå i inbjudan<input value={location} maxLength={500} onChange={e=>setLocation(e.target.value)}/></label><CalendarTravelFields timezone={timezone} value={travel} onChange={setTravel} disabled={!maps||busy}/></>}
   <button className="btn primary" disabled={busy||!title.trim()||!start||!end||(physical&&!maps)} onClick={()=>run("prepare")}>{busy?"Kontrollerar…":"Kontrollera och reservera preliminärt"}</button>
  </fieldset>:<section className="calendar-approval" aria-label="Granska möte och utskick"><h3>{plan.title}</h3><p>{new Date(plan.starts_at).toLocaleString('sv-SE',{timeZone:timezone})} – {new Date(plan.ends_at).toLocaleString('sv-SE',{timeZone:timezone})} · {timezone}</p>
   <p>{plan.meeting_details.locationLabel||"Ingen fysisk plats"}</p><p style={{whiteSpace:"pre-wrap"}}>{plan.meeting_details.description}</p>
   {plan.meeting_details.travel&&<p>Reserverat för resa och buffert: {plan.preparation_minutes} minuter före och {plan.recovery_minutes} minuter efter. Båda restiderna kontrolleras igen vid godkännande. Om de inte ryms bokas inget.</p>}
   {travelReview&&<p>Google Maps uppskattar resan dit till {travelReview.inboundMinutes} minuter och resan vidare/tillbaka till {travelReview.outboundMinutes} minuter.</p>}
   <h4>Inbjudningar från din masterkalender</h4>{plan.meeting_details.attendees.length?<><ul>{plan.meeting_details.attendees.map(email=><li key={email}>{email}</li>)}</ul><label><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)}/> Jag godkänner att Google skickar kalenderinbjudningar till dessa adresser.</label></>:<p>Inga mottagare. Inga inbjudningar skickas.</p>}
   <p>Reservationen löper ut {new Date(plan.expires_at).toLocaleTimeString('sv-SE',{timeZone:timezone})}. Ett oklart resultat kontrolleras med samma boknings-ID, inte ett nytt utskick.</p>
   <div className="calendar-actions"><button className="btn primary" disabled={busy||(plan.meeting_details.attendees.length>0&&!approved)} onClick={()=>run("confirm")}>Godkänn bokning{plan.meeting_details.attendees.length?" och skicka inbjudningar":""}</button><button className="btn" disabled={busy} onClick={()=>run("release")}>Avstå</button></div>
  </section>}
 </details>;
}
