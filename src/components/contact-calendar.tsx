"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
type Item={id:string;title:string;start:string|null;end:string|null;timezone:string;source:string;locationKind:string;placeLabel:string;status:string};
export function ContactCalendar({personId}:{personId:string}) {
 const [items,setItems]=useState<Item[]|null>(null),[error,setError]=useState("");
 useEffect(()=>{const c=new AbortController();void fetch(`/api/calendar/context?personId=${encodeURIComponent(personId)}`,{cache:"no-store",signal:c.signal}).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error);setItems(data.items);}).catch(e=>{if(e.name!=="AbortError")setError(e.message);});return()=>c.abort();},[personId]);
 return <section className="card"><h2>Kalenderbokningar med kontakten</h2>{error?<p role="alert">{error}</p>:items===null?<p>Hämtar kalenderkopplingar…</p>:items.length===0?<p>Inga kalenderbokningar är kopplade ännu.</p>:items.map(item=><article key={item.id}><h3>{item.title}</h3><p>{item.start?new Date(item.start).toLocaleString("sv-SE",{timeZone:item.timezone}):"Utanför det senast hämtade kalenderintervallet"} · {item.source}{item.status==="cancelled"?" · Avbokad":""}</p><p>{item.locationKind==="digital"?"Digitalt möte":item.placeLabel||"Plats ej angiven"}</p></article>)}<Link href="/?view=calendar">Öppna kalendern</Link><p className="muted">Kontaktkopplingar är inte kalenderinbjudningar.</p></section>;
}
