"use client";
import {useEffect,useRef,useState} from "react";
import type {CalendarEvent} from "@/lib/calendar/types";
import type {DisplayCalendar} from "@/lib/calendar/display";
const shift=(date:string,days:number)=>new Date(Date.parse(date)+days*86400000).toISOString().slice(0,10);
export function CalendarBoard({events,calendars,date,onDate,timezone}:{events:CalendarEvent[];calendars:DisplayCalendar[];date:string;onDate:(date:string)=>void;timezone:string}) {
 const [hidden,setHidden]=useState<string[]>([]);
 const source=(event:CalendarEvent)=>calendars.find(c=>c.id===event.calendarId);
 const color=(event:CalendarEvent)=>({borderColor:source(event)?.color,borderLeftWidth:4});
 const [view,setView]=useState<"week"|"month"|"day">("week");
 const [selected,setSelected]=useState<CalendarEvent|null>(null);
 const scroll=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(scroll.current)scroll.current.scrollTop=view==='month'?0:480;},[view]);
 const localDay=(instant:string)=>new Intl.DateTimeFormat("sv-SE",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(instant));
 const time=(instant:string)=>new Intl.DateTimeFormat("sv-SE",{timeZone:timezone,hour:"2-digit",minute:"2-digit"}).format(new Date(instant));
 const weekday=(day:string)=>new Date(day+"T12:00:00Z").toLocaleDateString("sv-SE",{timeZone:"UTC",weekday:"short",day:"numeric"});
 const monday=(day:string)=>shift(day,-((new Date(day).getUTCDay()+6)%7));
 const start=view==="month"?monday(date.slice(0,7)+"-01"):view==="week"?monday(date):date;
 const days=Array.from({length:view==="month"?42:view==="week"?7:1},(_,i)=>shift(start,i));
 const visible=events.filter(e=>e.status!=="cancelled"&&!hidden.includes(e.calendarId));
 // End instants are exclusive, including midnight at the end of all-day events.
 const onDay=(day:string)=>visible.filter(e=>localDay(e.start)<=day&&localDay(new Date(Date.parse(e.end)-1).toISOString())>=day);
 const navigate=(direction:number)=>{
  if(view!=="month")return onDate(shift(date,direction*(view==="week"?7:1)));
  const d=new Date(date.slice(0,7)+"-01");d.setUTCMonth(d.getUTCMonth()+direction);onDate(d.toISOString().slice(0,10));
 };
 return <section className="calendar-panel calendar-board" aria-label="Kalender med datum och tider">
  <div className="calendar-board-toolbar"><div><h2>{new Date(date+"T12:00:00Z").toLocaleDateString("sv-SE",{month:"long",year:"numeric",timeZone:"UTC"})}</h2><small>{timezone} · Alla valda kalendrar</small></div><div className="calendar-actions"><button className="btn" aria-label="Föregående period" onClick={()=>navigate(-1)}>←</button><button className="btn" onClick={()=>onDate(localDay(new Date().toISOString()))}>Idag</button><button className="btn" aria-label="Nästa period" onClick={()=>navigate(1)}>→</button><label>Datum<input type="date" value={date} onChange={e=>{if(e.target.value)onDate(e.target.value);}}/></label></div><div className="calendar-actions">{([['day','Dag'],['week','Vecka'],['month','Månad']] as const).map(([key,label])=><button className={`btn ${view===key?'primary':''}`} aria-pressed={view===key} key={key} onClick={()=>setView(key)}>{label}</button>)}</div></div>
  <fieldset className="calendar-source-filters"><legend>Visa kalendrar</legend>{calendars.map(c=><label key={c.id}><input type="checkbox" checked={!hidden.includes(c.id)} onChange={e=>{setHidden(current=>e.target.checked?current.filter(id=>id!==c.id):[...current,c.id]);setSelected(null);}}/><span aria-hidden="true" style={{background:c.color}}/>{c.label}</label>)}</fieldset>
  <p className="muted">Externa bokningar visas som underlag, inte som godkända masterbokningar. Filtren ändrar endast vyn, inte synkronisering eller konfliktkontroll.</p>
  <div className="calendar-board-scroll" ref={scroll}>
  {view==="month"?<div className="calendar-month">{['mån','tis','ons','tor','fre','lör','sön'].map(d=><strong className="calendar-day-heading" key={d}>{d}</strong>)}{days.map(d=><div className={`calendar-month-day ${d.slice(0,7)!==date.slice(0,7)?'outside':''}`} key={d}><button className="calendar-date-link" onClick={()=>{onDate(d);setView('day');}}>{Number(d.slice(8))}</button>{onDay(d).map(e=><button className="calendar-event-chip" style={color(e)} title={source(e)?.label} key={e.id} onClick={()=>setSelected(e)}>{e.allDay?'Heldag':time(e.start)} · {e.title||'Utan rubrik'}</button>)}</div>)}</div>:
  <div className="calendar-time-grid" style={{gridTemplateColumns:`54px repeat(${days.length}, minmax(110px,1fr))`}}>
   <div className="calendar-day-heading">Tid</div>{days.map(d=><strong className="calendar-day-heading" key={d}>{weekday(d)}</strong>)}
   <small className="calendar-all-day">Heldag</small>{days.map(d=><div className="calendar-all-day" key={d}>{onDay(d).filter(e=>e.allDay).map(e=><button className="calendar-event-chip" style={color(e)} title={source(e)?.label} key={e.id} onClick={()=>setSelected(e)}>{e.title}</button>)}</div>)}
   <div className="calendar-hours">{Array.from({length:24},(_,h)=><div key={h}>{String(h).padStart(2,'0')}:00</div>)}</div>
   {days.map(d=><div className="calendar-time-day" key={d}>{Array.from({length:24},(_,h)=><div className="calendar-hour-line" key={h}/>)}{onDay(d).filter(e=>!e.allDay).map((e,index,items)=>{
    const minutes=(s:string)=>{const [h,m]=time(s).split(':').map(Number);return h*60+m;};
    const from=localDay(e.start)<d?0:minutes(e.start),to=localDay(e.end)>d?1440:minutes(e.end);
    // Separate overlapping items into lanes so their text never overprints.
    const overlaps=[...items].sort((a,b)=>a.start.localeCompare(b.start));
    const lane=overlaps.findIndex(x=>x.id===e.id),width=100/overlaps.length;
    return <button key={`${e.id}-${index}`} className="calendar-timed-event" style={{...color(e),top:from/60*60,height:Math.max(24,(to-from)),left:`${lane*width}%`,width:`${width}%`}} onClick={()=>setSelected(e)} title={`${source(e)?.label} · ${e.title} ${time(e.start)}–${time(e.end)}`}><strong>{e.title||'Utan rubrik'}</strong><span>{time(e.start)}–{time(e.end)}</span></button>;
   })}</div>)}
  </div>}
  </div><p className="muted">Tomma rutor visar inga inlästa bokningar – ledig tid bekräftas först efter synkronisering och konfliktkontroll.</p>
  {selected&&<div className="calendar-notice" role="region" aria-label="Bokningsdetaljer"><button className="btn" onClick={()=>setSelected(null)}>Stäng detaljer</button><h3>{selected.title}</h3><p>{source(selected)?.label}</p><strong>{selected.calendarId==="holds"?"Preliminär reservation":source(selected)?.master?"Masterbokning":"Extern bokning – inte överförd till masterkalendern"}</strong><p>{localDay(selected.start)} · {selected.allDay?'Heldag':`${time(selected.start)}–${time(selected.end)}`}</p>{selected.location&&<p>{selected.location}</p>}<small>{selected.status==='tentative'?'Preliminär reservation':'Bokning'}</small></div>}
 </section>;
}
