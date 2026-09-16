"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import type {PlaceCandidate} from "@/lib/calendar/places-routing";
type Person={id:string;display_name:string;organization:string|null};
export function CalendarEventContext({sourceId,eventId}:{sourceId:string;eventId:string}) {
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
 const [people,setPeople]=useState<Person[]>([]),[results,setResults]=useState<Person[]>([]),[search,setSearch]=useState("");
 const [revision,setRevision]=useState(0),[conversationId,setConversationId]=useState<string|null>(null);
 const [kind,setKind]=useState("unknown"),[label,setLabel]=useState(""),[url,setUrl]=useState(""),[placeId,setPlaceId]=useState<string|null>(null);
 const [maps,setMaps]=useState(false),[placeQuery,setPlaceQuery]=useState(""),[places,setPlaces]=useState<PlaceCandidate[]>([]);
 useEffect(()=>{
  const controller=new AbortController();
  void fetch(`/api/calendar/context?sourceId=${encodeURIComponent(sourceId)}&eventId=${encodeURIComponent(eventId)}`,{cache:"no-store",signal:controller.signal}).then(async r=>{
   const data=await r.json();if(!r.ok)throw new Error(data.error);const c=data.context;
   setPeople(data.people);if(c){setRevision(c.revision);setConversationId(c.conversation_id);setKind(c.location_kind);setLabel(c.user_place_label);setUrl(c.meeting_url);setPlaceId(c.google_place_id);}setReady(true);
  }).catch(e=>{if(e.name!=="AbortError")setError(e.message);});
  void fetch("/api/calendar/planning",{cache:"no-store",signal:controller.signal}).then(r=>r.ok?r.json():null).then(data=>{if(data)setMaps(data.mapsEnabled);}).catch(()=>{});
  return()=>controller.abort();
 },[sourceId,eventId]);
 const run=async(action:"people"|"places"|"save")=>{
  setBusy(true);setMessage("");setError("");
  try {
   const response=action==="people"?await fetch(`/api/calendar/context?search=${encodeURIComponent(search)}`,{cache:"no-store"}):await fetch(action==="places"?"/api/calendar/planning":"/api/calendar/context",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(action==="places"?{action:"places",query:placeQuery}:{sourceId,eventId,revision,personIds:people.map(p=>p.id),conversationId,locationKind:kind,googlePlaceId:kind==="physical"?placeId:null,userPlaceLabel:label,meetingUrl:kind==="digital"?url:""})});
   const data=await response.json();if(!response.ok)throw new Error(data.error);
   if(action==="people")setResults(data.people);
   if(action==="places")setPlaces(data.places);
   if(data.context){setRevision(data.context.revision);setMessage("Kopplingarna är sparade. Ingen kalenderinbjudan skickades och originalbokningen är oförändrad.");}
  }catch(e){setError(e instanceof Error?e.message:"Uppgifterna kunde inte sparas.");}finally{setBusy(false);}
 };
 return <details className="calendar-panel"><summary>Kontakter och plats för bokningen</summary>
  <p>Interna kopplingar i Communication Intelligence. Att lägga till en kontakt skickar ingen inbjudan.</p>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  <fieldset disabled={!ready||busy}><legend>Kopplade kontakter</legend>
   {people.map(p=><div className="calendar-actions" key={p.id}><Link href={`/contacts/${p.id}`}>{p.display_name}</Link><span>{p.organization}</span><button className="btn" onClick={()=>setPeople(people.filter(x=>x.id!==p.id))}>Ta bort koppling</button></div>)}
   <label>Sök kontakt på namn<input value={search} maxLength={100} onChange={e=>setSearch(e.target.value)}/></label><button className="btn" disabled={search.trim().length<2} onClick={()=>run("people")}>Sök kontakter</button>
   {results.map(p=><button className="btn" key={p.id} disabled={people.some(x=>x.id===p.id)||people.length>=30} onClick={()=>setPeople([...people,p])}>{p.display_name}{p.organization?` · ${p.organization}`:""}</button>)}
  </fieldset>
  <fieldset disabled={!ready||busy}><legend>Plats</legend>
   <label>Mötesform<select value={kind} onChange={e=>{setKind(e.target.value);setPlaceId(null);setPlaces([]);setUrl("");}}><option value="unknown">Ännu inte bestämd</option><option value="digital">Digitalt möte</option><option value="physical">Fysisk plats</option></select></label>
   <label>Egen platsbeskrivning<input value={label} maxLength={500} onChange={e=>setLabel(e.target.value)} placeholder="Till exempel hemma, kontoret eller adress från konversationen"/></label>
   {kind==="digital"&&<label>Möteslänk (https)<input type="url" value={url} maxLength={2000} onChange={e=>setUrl(e.target.value)}/></label>}
   {kind==="physical"&&<>{maps?<><label>Sök plats i Google Maps<input value={placeQuery} maxLength={300} onChange={e=>setPlaceQuery(e.target.value)}/></label><button className="btn" disabled={placeQuery.trim().length<3} onClick={()=>run("places")}>Sök plats</button><p translate="no">Google Maps</p>{places.map(p=><div className="calendar-hold" key={p.id}><strong>{p.name}</strong><p>{p.address}</p><a href={p.mapsUrl} target="_blank" rel="noopener noreferrer">Visa på Google Maps</a><button className="btn" onClick={()=>setPlaceId(p.id)}>Koppla denna plats</button></div>)}</>:<p>Google Maps är förberett men inte aktiverat. Din egen platsbeskrivning kan sparas nu.</p>}{placeId&&<p>En kartplats är vald. Restid och aktuell adress behöver kontrolleras före bokning.</p>}</>}
   <button className="btn primary" onClick={()=>run("save")}>Spara kontakter och plats</button>
  </fieldset>
 </details>;
}
