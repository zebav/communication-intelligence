"use client";
import {useState} from "react";
import type {CalendarEvent} from "@/lib/calendar/types";
import {reviewCommitments} from "@/lib/calendar/reconciliation";

export function CalendarCommitmentReview({name,account,events,master,now,busy,onCopy,format}:{
 name:string;account:string;events:CalendarEvent[];master:CalendarEvent[];now:number;busy:boolean;
 onCopy:(event:CalendarEvent)=>void;format:(value:string)=>string;
}) {
 const [filter,setFilter]=useState("attention"),[query,setQuery]=useState(""),[limit,setLimit]=useState(25);
 const reviews=reviewCommitments(events,master,name);
 const attention=reviews.filter(r=>["missing","conflict"].includes(r.status)&&Date.parse(r.event.end)>now);
 const visible=reviews.filter(r=>(filter==="all"||filter==="attention"&&attention.includes(r)||filter===r.status)
  &&r.event.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 return <details className="calendar-source"><summary>{name} · {account} · {attention.length} att ta ställning till</summary>
  <p>Granska varje åtagande. En godkänd kopia ändrar inte originalet och skickar inga inbjudningar. Informationsposter är en sortering, inte ett automatiskt godkännande av kalendern.</p>
  <div className="calendar-form"><label>Visa<select value={filter} onChange={e=>{setFilter(e.target.value);setLimit(25);}}>
   <option value="attention">Behöver beslut ({attention.length})</option><option value="informational">Kalenderinformation</option><option value="matched">Möjlig motsvarighet i master</option><option value="all">Alla poster, även tidigare</option>
  </select></label><label>Sök bokning<input value={query} onChange={e=>{setQuery(e.target.value);setLimit(25);}}/></label></div>
  {!visible.length&&<p>Inga poster i detta urval. Avstämningen godkänns inte automatiskt.</p>}
  <ul className="calendar-events">{visible.slice(0,limit).map(r=><li key={r.event.id}><strong>{r.event.title||"Utan rubrik"}</strong><span>{format(r.event.start)} – {format(r.event.end)}</span>
   <small>{r.status==="informational"?"Kalenderinformation – föreslås inte som möte.":r.status==="matched"?"Möjlig motsvarighet i master – kontrollera att det är samma åtagande.":r.status==="conflict"?"Överlappar en masterbokning. Behöver ditt beslut.":"Saknas i master. Granska om åtagandet ska gälla."}</small>
   {r.status==="missing"&&Date.parse(r.event.start)>now&&<button className="btn" disabled={busy} onClick={()=>onCopy(r.event)}>Godkänn kopia i master / kontrollera tidigare försök</button>}
  </li>)}</ul>
  {visible.length>limit&&<button className="btn" onClick={()=>setLimit(limit+25)}>Visa fler ({visible.length-limit} kvar)</button>}
 </details>;
}
