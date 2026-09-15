"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- OAuth endpoints require full navigation, never route prefetch. */
import { useCallback,useEffect,useState } from "react";
import type { CalendarEvent } from "@/lib/calendar/types";
import { meetingDefaults } from "@/lib/calendar/types";
import { schedulingIntent } from "@/lib/calendar/intent";
import type { SchedulingCandidate } from "@/lib/calendar/scheduling";
import "./calendar-workspace.css";
import {CalendarBoard} from "./calendar-board";
import {calendarDisplay} from "@/lib/calendar/display";
import {CalendarPlanning} from "./calendar-planning";
import {reviewCommitments} from "@/lib/calendar/reconciliation";
import {transferFingerprint} from "@/lib/calendar/transfer-format";
import {CalendarEventActions} from "./calendar-event-actions";
import {CalendarIntents} from "./calendar-intents";

type Source={id:string;account_id:string;name:string;is_master:boolean;enabled:boolean;snapshot:CalendarEvent[];reviewed_snapshot:CalendarEvent[]|null;synced_at:string|null;sync_error:string|null};
type Hold={id:string;title:string;starts_at:string;ends_at:string;status:string;expires_at:string;preparation_minutes:number;recovery_minutes:number;purpose?:"booking"|"move"};
type Snapshot={accounts:{id:string;address:string;provider:string}[];sources:Source[];workspace:{timezone:string;provisioning:string}|null;holds:Hold[]};
export type CalendarConversation={id:string;title:string;person:string;text:string};
export function CalendarWorkspace({conversations}:{conversations:CalendarConversation[]}) {
 const [data,setData]=useState<Snapshot|null>(null),[error,setError]=useState(""),[status,setStatus]=useState(""),[busy,setBusy]=useState(false);
 const [tab,setTab]=useState("agenda"),[date,setDate]=useState(()=>new Date().toLocaleDateString("sv-SE")),[title,setTitle]=useState(""),[conversationId,setConversationId]=useState("");
 const [duration,setDuration]=useState(45),[preparation,setPreparation]=useState(10),[recovery,setRecovery]=useState(10),[physical,setPhysical]=useState(false),[slots,setSlots]=useState<SchedulingCandidate[]>([]);
 const [accountId,setAccountId]=useState(""),[timezone,setTimezone]=useState("Europe/Stockholm"),[approval,setApproval]=useState<Hold|null>(null);
 const [now,setNow]=useState(()=>Date.now());
 const [managedEvent,setManagedEvent]=useState<CalendarEvent|null>(null);
 const [consentResult]=useState(()=>typeof window==="undefined"?null:new URLSearchParams(window.location.search).get("calendar"));
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer);},[]);
 const load=useCallback(async(signal?:AbortSignal)=>{
  const response=await fetch("/api/calendar",{cache:"no-store",signal}); const next=await response.json();
  if(!response.ok) throw new Error(next.error||"Kalendern kunde inte hämtas.");
  setData(next); if(next.workspace?.timezone) setTimezone(next.workspace.timezone);
 },[]);
 // State is updated after the awaited network response, not synchronously in this effect.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{const controller=new AbortController();void load(controller.signal).catch(e=>{if(e.name!=="AbortError") setError(e.message);});return()=>controller.abort();},[load]);
 const run=async(body:Record<string,unknown>)=>{
  setBusy(true);setError("");setStatus("");
  try {
   if(body.action==="sync_all") {
    const sources=data?.sources.filter(s=>s.enabled)??[];
    const failed:string[]=[];
    for(let i=0;i<sources.length;i++) {
     const source=sources[i];setStatus(`Synkroniserar ${i+1} av ${sources.length}: ${source.name}`);
     try {
      const response=await fetch("/api/calendar",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"sync",sourceId:source.id}),signal:AbortSignal.timeout(65000)});
      if(!response.ok)failed.push(source.name);
     }catch{failed.push(source.name);}
    }
    setSlots([]);await load();
    if(failed.length)setError(`Kunde inte synkronisera: ${failed.join(", ")}. Tidigare data behålls. Inga tider får bokas på ofullständigt underlag.`);
    setStatus(`${sources.length-failed.length} av ${sources.length} kalendrar synkroniserade.`);
    return;
   }
   const response=await fetch("/api/calendar",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}), result=await response.json();
   if(!response.ok) throw new Error(result.error||"Åtgärden kunde inte genomföras.");
   if(result.slots) {setSlots(result.slots);if(result.preparation!==undefined)setPreparation(result.preparation);if(result.recovery!==undefined)setRecovery(result.recovery);setStatus(result.slots.length?"Tidsförslagen är framtagna.":"Inga tider hittades inom planeringsreglerna. Välj en annan dag eller granska reglerna.");}
   else {setSlots([]);setStatus("Åtgärden är sparad.");await load();setApproval(null);}
  }catch(e){setError(e instanceof Error?e.message:"Kalenderfel");}finally{setBusy(false);}
 };
 const fmt=(value:string)=>new Intl.DateTimeFormat("sv-SE",{timeZone:timezone,dateStyle:"medium",timeStyle:"short"}).format(new Date(value));
 const day=(value:string)=>new Intl.DateTimeFormat("sv-SE",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value));
 const master=data?.sources.find(s=>s.is_master);
 const display=calendarDisplay(data?.sources??[],data?.accounts??[]);
 const external=data?.sources.filter(s=>!s.is_master&&s.enabled)??[];
 const selectedConversation=conversations.find(c=>c.id===conversationId);
 const eventRows=(master?.snapshot??[]).filter(e=>e.status!=="cancelled").filter(e=>tab==="day"?day(e.start)<=date&&day(e.end)>=date:tab==="week"?day(e.start)>=date&&day(e.start)<new Date(Date.parse(date)+7*86400000).toISOString().slice(0,10):day(e.end)>=date).sort((a,b)=>a.start.localeCompare(b.start));
 return <section className="calendar-page">
  <header className="calendar-header"><div><p className="muted">Din tid, samlad på ett ställe</p><h1>Masterkalender</h1><p>Masterkalendern bestämmer. Andra kalendrar lämnar underlag för din avstämning.</p></div><button className="btn" disabled={busy} onClick={()=>{setError("");void load().catch(e=>setError(e.message));}}>Uppdatera vyn</button></header>
  {error&&<div className="calendar-notice error" role="alert">{error}</div>}{status&&<p role="status" className="calendar-notice">{status}</p>}
  {consentResult&&<p className="calendar-notice" role="status">{consentResult==="connected"?"Kalenderkontot är anslutet. Hämta kalenderlistan nedan.":consentResult==="callback_setup"?"Testversionens returadress behöver registreras hos Google/Microsoft och anges i Vercel innan kalendern kan anslutas.":consentResult==="missing_permissions"?"Alla kalenderbehörigheter godkändes inte. Din mejlanslutning är oförändrad.":"Kalenderanslutningen blev inte klar. Kontrollera konfigurationen innan du försöker igen."}</p>}
  {!data&&!error&&<p role="status">Hämtar kalendern…</p>}
  <CalendarBoard calendars={[...display.calendars,{id:'holds',label:'Preliminära reservationer',master:true,color:'#f4d37b'}]} date={date} onDate={value=>{setDate(value);setSlots([]);}} timezone={timezone} events={[...display.events,...(data?.holds??[]).filter(h=>h.status==='active'&&Date.parse(h.expires_at)>now).map(h=>({id:h.id,calendarId:'holds',title:h.title,timezone,start:h.starts_at,end:h.ends_at,allDay:false,status:'tentative' as const,blocksAvailability:true}))]}/>
  <details className="calendar-panel" open={!master}><summary>Anslutningar och masterkalender</summary>
   <p>Kalenderåtkomst godkänns separat från mejlen. Inga befintliga bokningar ändras när du ansluter.</p>
   <div className="calendar-actions"><a className="btn" href="/api/calendar/connect/google">Anslut Google Kalender</a><a className="btn" href="/api/calendar/connect/microsoft">Anslut Outlook-kalender</a></div>
   {data?.accounts.map(a=><div className="calendar-account" key={a.id}><div><strong>{a.address}</strong><small>{a.provider==="google"?"Google":"Microsoft 365 / Outlook"}</small></div><button className="btn" disabled={busy} onClick={()=>run({action:"discover",accountId:a.id})}>Hämta kalenderlista</button></div>)}
   {!master&&data&&<div className="calendar-form"><label>Google-konto för masterkalendern<select value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="">Välj konto</option>{data.accounts.filter(a=>a.provider==="google").map(a=><option key={a.id} value={a.id}>{a.address}</option>)}</select></label><label>Tidszon<input value={timezone} onChange={e=>setTimezone(e.target.value)}/></label><button className="btn primary" disabled={busy||!accountId||Boolean(data.workspace&&data.workspace.provisioning!=="idle")} onClick={()=>run({action:"create_master",accountId,timezone,approved:true})}>Godkänn och skapa separat masterkalender</button><small>Skapar en ny kalender hos Google. Inga inbjudningar skickas.</small>{data.workspace?.provisioning==="uncertain"&&<p role="alert">Ett tidigare försök behöver kontrolleras hos Google innan en ny kalender skapas.</p>}</div>}
  </details>
  {data&&<>
   <CalendarIntents conversations={conversations} onUse={(id,intent)=>{setConversationId(id);setTitle(intent.summary.slice(0,300));if(intent.date)setDate(intent.date);const defaults=meetingDefaults[intent.meetingType];setDuration(intent.durationMinutes??defaults.durationMinutes);setPreparation(defaults.preparationMinutes);setRecovery(defaults.recoveryMinutes);setPhysical(Boolean(intent.locationText));setSlots([]);setStatus("Granska datum, plats, längd och buffertar innan du söker tider. Ingen bokning har gjorts.");}}/>
   {managedEvent&&master&&<CalendarEventActions key={managedEvent.id} sourceId={master.id} event={managedEvent} onDone={load} onClose={()=>setManagedEvent(null)}/>}
   {master&&<details className="calendar-panel"><summary>Hantera befintlig masterbokning</summary><p>Välj en bokning för att granska rubrikändring eller avbokning. Inga externa källkalendrar ändras.</p><div className="calendar-form"><label>Bokning<select value={managedEvent?.id??""} onChange={e=>setManagedEvent(master.snapshot.find(item=>item.id===e.target.value)??null)}><option value="">Välj bokning</option>{master.snapshot.filter(e=>e.status!=="cancelled").map(e=><option key={e.id} value={e.id}>{fmt(e.start)} · {e.title}</option>)}</select></label></div></details>}
   <CalendarPlanning timezone={timezone} onSaved={rules=>{setSlots([]);setPreparation(rules.preparationMinutes);setRecovery(rules.recoveryMinutes);}}/>
   <section className="calendar-panel"><h2>Samlad synkronisering och avstämning</h2><p>Hämta alla aktiva kalendrar med ett klick. Detta är manuell synkronisering; bakgrundskörningen är ännu inte aktiverad.</p><button className="btn primary" disabled={busy} onClick={()=>run({action:"sync_all"})}>{busy?"Arbetar…":"Synkronisera alla kalendrar"}</button>
    {external.map(source=>{const reviews=reviewCommitments(source.snapshot,master?.snapshot??[]);return <details key={source.id} className="calendar-source"><summary>{source.name} · {reviews.filter(r=>r.status==="missing").length} saknas i master · {reviews.filter(r=>r.status==="conflict").length} möjliga konflikter</summary><p>Matchningar är förslag baserade på titel, plats och exakt tid. En godkänd kopia ändrar inte originalet och skickar inga inbjudningar.</p><ul className="calendar-events">{reviews.slice(0,100).map(r=><li key={r.event.id}><strong>{r.event.title||"Utan rubrik"}</strong><span>{fmt(r.event.start)} – {fmt(r.event.end)}</span><small>{r.status==="matched"?"Motsvarande bokning finns i master – kontrollera att det är samma åtagande.":r.status==="conflict"?"Överlappar en masterbokning – behöver ditt beslut.":r.status==="missing"?"Saknas i master – behöver föras över eller undantas före avstämning.":"Informationspost – blockerar inte tid."}</small>{r.status==="missing"&&Date.parse(r.event.start)>now&&<button className="btn" disabled={busy||!master} onClick={()=>run({action:"transfer",sourceId:source.id,eventId:r.event.id,fingerprint:transferFingerprint(r.event),approved:true})}>Godkänn kopia i master / kontrollera tidigare försök</button>}</li>)}</ul>{reviews.length>100&&<p>Visar de första 100 av {reviews.length} poster. Granska resterande i kalendervyn innan avstämning.</p>}</details>;})}
   </section>
   <details className="calendar-panel"><summary>Mötesförfrågningar från konversationer</summary><p>Första urvalet bygger på tydliga mötesord. Datum och bokning måste granskas av dig.</p>{conversations.filter(c=>schedulingIntent(c.text).detected).slice(0,30).map(c=>{const intent=schedulingIntent(c.text);return <div className="calendar-account" key={c.id}><div><strong>{c.person}</strong><small>{c.title}</small><small>{intent.reason}</small></div>{intent.operation==="propose"?<button className="btn" onClick={()=>{const defaults=meetingDefaults[intent.type];setConversationId(c.id);setTitle(c.title.slice(0,300));setDuration(defaults.durationMinutes);setPreparation(defaults.preparationMinutes);setRecovery(defaults.recoveryMinutes);if(intent.date)setDate(intent.date);setSlots([]);setStatus(intent.reason);}}>Ta fram tidsförslag</button>:<span>Granska befintlig bokning i kalendern. Inget ändras automatiskt.</span>}</div>;})}</details>
   <section className="calendar-panel"><h2>1. Synkronisera och stäm av</h2><p>Synkronisering hämtar 7 dagar bakåt och 60 dagar framåt. Granska bokningarna nedan innan du godkänner att underlaget är avstämt.</p>
   {data.sources.map(s=><details className="calendar-source" key={s.id}><summary>{s.is_master?"Master · ":"Förslag · "}{s.name} — {data.accounts.find(a=>a.id===s.account_id)?.address}</summary><div className="calendar-actions"><button className="btn" disabled={busy||!s.enabled} onClick={()=>run({action:"sync",sourceId:s.id})}>Synkronisera</button>{!s.is_master&&<label><input type="checkbox" checked={s.enabled} disabled={busy} onChange={e=>run({action:"enabled",sourceId:s.id,enabled:e.target.checked})}/> Använd som underlag</label>}</div><p>{s.synced_at?`Senast hämtad: ${fmt(s.synced_at)}`:"Inte synkroniserad"}</p>{s.sync_error&&<p role="alert">{s.sync_error}</p>}{!s.is_master&&<><ul className="calendar-events">{s.snapshot.map(e=><li key={e.id}><strong>{e.title||"Utan rubrik"}</strong><span>{fmt(e.start)} – {fmt(e.end)}</span><small>{e.status==="cancelled"?"Avbokad":e.blocksAvailability?"Åtagande att granska":"Markerad som ledig/avböjd"}</small></li>)}</ul><button className="btn" disabled={busy||!s.synced_at||Boolean(s.sync_error)||!s.enabled} onClick={()=>run({action:"review",sourceId:s.id,syncedAt:s.synced_at})}>Jag har stämt av dessa åtaganden mot masterkalendern</button><small>{JSON.stringify(s.snapshot)===JSON.stringify(s.reviewed_snapshot)?"Avstämt":"Behöver avstämning. För över åtaganden som gäller innan du godkänner."}</small></>}</details>)}
   </section>
   <div className="calendar-columns"><section className="calendar-panel"><h2>2. Din masterkalender</h2><div className="calendar-actions" role="group" aria-label="Kalendervy">{[["day","Dag"],["week","7 dagar"],["agenda","Agenda"]].map(([key,label])=><button key={key} className={`btn ${tab===key?"primary":""}`} onClick={()=>setTab(key)}>{label}</button>)}<label>Från datum<input type="date" value={date} onChange={e=>{setDate(e.target.value);setSlots([]);}}/></label></div><p className="muted">Tider visas i {timezone}. Tom vy är inte ett besked om ledig tid innan synkronisering och avstämning är klara.</p><ul className="calendar-events">{eventRows.map(e=><li key={e.id}><strong>{e.title||"Utan rubrik"}</strong><span>{fmt(e.start)} – {fmt(e.end)}</span>{e.allDay&&<small>Heldag</small>}</li>)}</ul>{eventRows.length===0&&<p>Inga masterbokningar visas i den valda perioden.</p>}
   <h3>Reservationer och nyligen bokat</h3>{data.holds.filter(h=>h.status!=="released"&&(h.status!=="active"||Date.parse(h.expires_at)>now)).map(h=><article className="calendar-hold" key={h.id}><strong>{h.title}</strong><span>{fmt(h.starts_at)} – {fmt(h.ends_at)}</span><small>{h.preparation_minutes} min före · {h.recovery_minutes} min efter</small><p>{h.status==="confirmed"?"Bokat i masterkalendern":h.status==="executing"?"Bokningsresultatet behöver kontrolleras":`Preliminärt till ${fmt(h.expires_at)}`}</p>{h.purpose==="move"&&h.status!=="confirmed"?<p>Reserverad för flytt. Öppna den ursprungliga masterbokningen under Hantera masterbokning för att godkänna eller kontrollera flytten.</p>:h.status!=="confirmed"&&<div className="calendar-actions"><button className="btn primary" disabled={busy} onClick={()=>setApproval(h)}>{h.status==="executing"?"Kontrollera bokning":"Granska och boka"}</button>{h.status==="active"&&<button className="btn" disabled={busy} onClick={()=>run({action:"release",holdId:h.id})}>Släpp tiden</button>}</div>}</article>)}
   </section><section className="calendar-panel"><h2>3. Föreslå en tid</h2><div className="calendar-form"><label>Koppla till konversation<select value={conversationId} onChange={e=>{setConversationId(e.target.value);const c=conversations.find(c=>c.id===e.target.value);if(c)setTitle(c.title.slice(0,300));}}><option value="">Fristående bokning</option>{conversations.map(c=><option key={c.id} value={c.id}>{c.person} · {c.title}</option>)}</select></label>{selectedConversation&&<details><summary>Läs konversationens underlag</summary><p className="calendar-message">{selectedConversation.text}</p><small>Kontrollera önskad dag och tid nedan. Otydliga formuleringar tolkas inte som en bekräftad bokning.</small></details>}<label>Rubrik<input maxLength={300} value={title} onChange={e=>setTitle(e.target.value)}/></label><label>Längd, minuter<input type="number" min={5} max={600} value={duration} onChange={e=>{setDuration(Number(e.target.value));setSlots([]);}}/></label><div className="calendar-actions"><label>Buffert före<input type="number" min={0} max={180} value={preparation} onChange={e=>{setPreparation(Number(e.target.value));setSlots([]);}}/></label><label>Buffert efter<input type="number" min={0} max={180} value={recovery} onChange={e=>{setRecovery(Number(e.target.value));setSlots([]);}}/></label></div><label><input type="checkbox" checked={physical} onChange={e=>{setPhysical(e.target.checked);setSlots([]);}}/> Fysiskt möte med resa</label>{physical&&<p>Restidskontroll är ännu inte ansluten. Förslag kan visas men inte bokas i detta flöde.</p>}<button className="btn primary" disabled={busy||!master||!date} onClick={()=>run({action:"suggest",date,duration,preparation,recovery,physical})}>Hitta tider {date}</button></div>
   {slots.map(slot=><article className="calendar-hold" key={slot.start}><strong>{fmt(slot.start)}</strong><span>Till {fmt(slot.end)}</span><ul>{slot.explanation.map(reason=><li key={reason}>{reason}</li>)}</ul><button className="btn" disabled={busy||!slot.bookable||!title.trim()} onClick={()=>run({action:"hold",title,start:slot.start,end:slot.end,preparation,recovery,physical:false,conversationId:conversationId||null})}>Reservera preliminärt i 20 minuter</button></article>)}
   {external.length>0&&<small>Externa kalendrar ändras aldrig av tidsförslagen.</small>}
   </section></div>
  </>}
  {approval&&<section className="calendar-panel calendar-approval" aria-label="Godkänn bokning"><h2>Godkänn bokning</h2><strong>{approval.title}</strong><p>{fmt(approval.starts_at)} – {fmt(approval.ends_at)}</p><p>Skapas endast i din separata masterkalender. Inga mejl eller kalenderinbjudningar skickas. Tiden kontrolleras igen före bokning.</p><div className="calendar-actions"><button className="btn primary" disabled={busy} onClick={()=>run({action:"confirm",holdId:approval.id,approved:true})}>{busy?"Kontrollerar…":"Godkänn och boka / kontrollera"}</button><button className="btn" disabled={busy} onClick={()=>setApproval(null)}>Avbryt</button></div></section>}
 </section>;
}
