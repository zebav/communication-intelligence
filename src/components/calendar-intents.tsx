"use client";
import {useCallback,useEffect,useState} from "react";
import type {CalendarIntent} from "@/lib/calendar/ai-intent";
type Row={id:string;conversation_id:string;proposal:CalendarIntent;status:string};
export function CalendarIntents({conversations,onUse}:{conversations:{id:string;title:string;person:string}[];onUse:(conversationId:string,intent:CalendarIntent)=>void}) {
 const [rows,setRows]=useState<Row[]>([]),[selected,setSelected]=useState(""),[search,setSearch]=useState("");
 const [error,setError]=useState(""),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
 const load=useCallback(async(signal?:AbortSignal)=>{
  const response=await fetch("/api/calendar/intents",{cache:"no-store",signal}),data=await response.json();
  if(!response.ok)throw new Error(data.error);return data.proposals as Row[];
 },[]);
 useEffect(()=>{const controller=new AbortController();void load(controller.signal).then(data=>{if(!controller.signal.aborted)setRows(data);}).catch(e=>{if(e.name!=="AbortError")setError(e.message);});return()=>controller.abort();},[load]);
 const run=async(body:Record<string,unknown>)=>{
  setBusy(true);setError("");setNotice("");
  try {const response=await fetch("/api/calendar/intents",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),data=await response.json();
   if(!response.ok)throw new Error(data.error);
   if(data.proposal?.status==="dismissed")setNotice("Analysen hittade ingen öppen förfrågan, eller samma förslag har redan stängts.");
   else if(data.proposal)setNotice(data.reused?"Samma sparade analys används; ingen ny AI-körning behövdes.":"Förslaget är sparat. Ingen tid har bokats.");
   setRows(await load());
  }catch(e){setError(e instanceof Error?e.message:"Förslaget kunde inte läsas.");}finally{setBusy(false);}
 };
 return <details className="calendar-panel"><summary>AI-förslag från konversationer · {rows.length} att granska</summary>
 <p>Analyserar de senaste tolv meddelandena i vald konversation. AI-förslag är inte bokningar. Datum, plats och tidszon behöver granskas.</p>
 {error&&<p className="calendar-notice error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 <div className="calendar-form"><label>Hitta konversation<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Sök person eller rubrik"/></label><label>Konversation<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Välj konversation</option>{conversations.filter(c=>`${c.person} ${c.title}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(c=><option key={c.id} value={c.id}>{c.person} · {c.title}</option>)}</select></label><button className="btn" disabled={busy||!selected} onClick={()=>run({action:"analyze",conversationId:selected})}>{busy?"Arbetar…":"Analysera mötesförfrågan"}</button></div>
 {rows.map(row=><article className="calendar-hold" key={row.id}><strong>{conversations.find(c=>c.id===row.conversation_id)?.person??"Konversation"}</strong><p>{row.proposal.summary}</p><small>{row.proposal.operation==="cancel"?"Möjlig avbokning":row.proposal.operation==="change"?"Möjlig ändring":"Mötesförslag"} · {row.proposal.date??"Datum behöver bekräftas"}</small>{row.proposal.locationText&&<p>Plats i meddelandet: {row.proposal.locationText} – inte platsverifierad.</p>}{row.proposal.questions.length>0&&<ul>{row.proposal.questions.map((q,i)=><li key={i}>{q}</li>)}</ul>}<details><summary>Visa meddelanden som underlag</summary>{row.proposal.evidence.map((e,i)=><blockquote key={i}>{e.quote}</blockquote>)}</details><div className="calendar-actions">{row.proposal.operation==="propose"&&<button className="btn" disabled={busy||!row.proposal.date} onClick={()=>onUse(row.conversation_id,row.proposal)}>Använd datum som underlag för tidsförslag</button>}<button className="btn" disabled={busy} onClick={()=>run({action:"dismiss",proposalId:row.id})}>Markera förslaget som hanterat</button></div>{!row.proposal.date&&row.proposal.operation==="propose"&&<small>Välj datum manuellt i kalenderns tidsförslag. AI gissar inte åt dig.</small>}{row.proposal.operation!=="propose"&&<small>Välj rätt befintlig masterbokning och granska åtgärden separat.</small>}</article>)}
 </details>;
}
