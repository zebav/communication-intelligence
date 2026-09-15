"use client";
import { useEffect, useState } from "react";
import { defaultPlanningPreferences, type PlanningPreferences } from "@/lib/calendar/planning-preferences";
import type { PlaceCandidate, RouteEstimate, RouteRequest } from "@/lib/calendar/places-routing";
import { zonedInstant } from "@/lib/calendar/time";

export function CalendarPlanning({timezone,onSaved}:{timezone:string;onSaved:(rules:PlanningPreferences)=>void}) {
  const [rules,setRules]=useState(defaultPlanningPreferences),[ready,setReady]=useState(false),[maps,setMaps]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [query,setQuery]=useState(""),[places,setPlaces]=useState<PlaceCandidate[]>([]);
  const [origin,setOrigin]=useState<PlaceCandidate|null>(null),[destination,setDestination]=useState<PlaceCandidate|null>(null);
  const [nextPlace,setNextPlace]=useState<PlaceCandidate|null>(null),[meetingStart,setMeetingStart]=useState(""),[meetingEnd,setMeetingEnd]=useState(""),[nextArrival,setNextArrival]=useState("");
  const [assessment,setAssessment]=useState<{status:string;expiresAt?:string;inbound?:RouteEstimate;outbound?:RouteEstimate}|null>(null);
  const [departure,setDeparture]=useState(""),[mode,setMode]=useState<RouteRequest["mode"]>("DRIVE"),[route,setRoute]=useState<RouteEstimate|null>(null);
  useEffect(()=>{
    const controller=new AbortController();
    void fetch("/api/calendar/planning",{cache:"no-store",signal:controller.signal}).then(async r=>{
      const data=await r.json();if(!r.ok)throw new Error(data.error);
      setRules(data.rules);setMaps(data.mapsEnabled);setReady(true);
    }).catch(e=>{if(e.name!=="AbortError")setError(e.message);});
    return()=>controller.abort();
  },[]);
  const run=async(body:Record<string,unknown>)=>{
    setBusy(true);setError("");setNotice("");
    try {
      const response=await fetch("/api/calendar/planning",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const data=await response.json();if(!response.ok)throw new Error(data.error);
      if(data.rules){setRules(data.rules);onSaved(data.rules);setNotice("Planeringsreglerna är sparade. Nya tidsförslag följer dessa regler.");}
      if(data.places)setPlaces(data.places);
      if(data.route)setRoute(data.route);
      if(data.assessment)setAssessment(data.assessment);
    }catch(e){setError(e instanceof Error?e.message:"Planeringen kunde inte uppdateras.");}finally{setBusy(false);}
  };
  return <details className="calendar-panel"><summary>Planeringsregler och restid</summary>
    <p>Reglerna gäller nya tidsförslag. Dina befintliga bokningar ändras inte.</p>
    {error&&<p role="alert" className="calendar-notice error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <fieldset disabled={!ready||busy} className="calendar-planning-fields"><legend>När vill du bli bokad?</legend>
      <div className="calendar-actions">{["Sön","Mån","Tis","Ons","Tor","Fre","Lör"].map((name,i)=><label key={i}><input type="checkbox" checked={rules.weekdays.includes(i)} onChange={e=>setRules({...rules,weekdays:e.target.checked?[...rules.weekdays,i].sort():rules.weekdays.filter(d=>d!==i)})}/>{name}</label>)}</div>
      <div className="calendar-form-grid"><label>Tidigaste tid<input type="time" value={rules.dayStart} onChange={e=>setRules({...rules,dayStart:e.target.value})}/></label><label>Senaste sluttid<input type="time" value={rules.dayEnd} onChange={e=>setRules({...rules,dayEnd:e.target.value})}/></label>
      <label>Minsta framförhållning (min)<input type="number" min={0} max={10080} value={rules.minimumNoticeMinutes} onChange={e=>setRules({...rules,minimumNoticeMinutes:Number(e.target.value)})}/></label>
      <label>Max bokad tid per dag (min, inkl. reservationers buffert)<input type="number" min={30} max={1440} value={rules.maximumMeetingMinutesPerDay} onChange={e=>setRules({...rules,maximumMeetingMinutesPerDay:Number(e.target.value)})}/></label>
      <label>Minsta förberedelse (min)<input type="number" min={0} max={180} value={rules.preparationMinutes} onChange={e=>setRules({...rules,preparationMinutes:Number(e.target.value)})}/></label>
      <label>Minsta återhämtning (min)<input type="number" min={0} max={180} value={rules.recoveryMinutes} onChange={e=>setRules({...rules,recoveryMinutes:Number(e.target.value)})}/></label></div>
      <p>Tidszon: {timezone}. För att boka utanför reglerna behöver du ändra dem först.</p><button className="btn" onClick={()=>run({action:"preferences",rules})}>Spara planeringsregler</button>
    </fieldset>
    <h3>Plats och reseplanering</h3>
    {!maps?<p>Google Maps-kopplingen är förberedd men inte aktiverad. Inga Maps-anrop görs. Aktivering kräver godkänd kostnad och servernyckel.</p>:<>
      <p>Välj rätt plats själv om flera matchningar finns. Detta är reseunderlag, inte en godkänd kalenderbokning.</p>
      <label>Sök en plats eller adress<input value={query} maxLength={300} onChange={e=>setQuery(e.target.value)}/></label><button className="btn" disabled={busy||query.trim().length<3} onClick={()=>run({action:"places",query})}>Sök plats</button>
      <p className="muted">Platsinformation: Google Maps</p>
      {places.map(p=><article className="calendar-hold" key={p.id}><strong>{p.name}</strong><span>{p.address}</span><a href={p.mapsUrl} target="_blank" rel="noopener noreferrer">Visa på Google Maps</a><div className="calendar-actions"><button className="btn" onClick={()=>{setOrigin(p);setRoute(null);setAssessment(null);}}>Startplats</button><button className="btn" onClick={()=>{setDestination(p);setRoute(null);setAssessment(null);}}>Mötesplats</button><button className="btn" onClick={()=>{setNextPlace(p);setAssessment(null);}}>Nästa plats efter mötet</button></div></article>)}
      <p>Från: {origin?.name||"Inte vald"} → Till: {destination?.name||"Inte vald"}</p>
      <div className="calendar-form-grid"><label>Avresa ({timezone})<input type="datetime-local" value={departure} onChange={e=>{setDeparture(e.target.value);setRoute(null);setAssessment(null);}}/></label><label>Färdsätt<select value={mode} onChange={e=>{setMode(e.target.value as RouteRequest["mode"]);setRoute(null);setAssessment(null);}}><option value="DRIVE">Bil</option><option value="WALK">Promenad</option><option value="BICYCLE">Cykel</option><option value="TRANSIT">Kollektivtrafik</option></select></label></div>
      <button className="btn" disabled={busy||!origin||!destination||!departure} onClick={()=>{try{const departureTime=zonedInstant(departure,timezone);setRoute(null);void run({action:"route",route:{originPlaceId:origin!.id,destinationPlaceId:destination!.id,departureTime,mode}});}catch{setError("Välj en entydig avresetid i kalenderns tidszon.");}}}>Beräkna restid</button>
      {route&&<p role="status">Uppskattad restid: {route.minutes} min · {(route.distanceMeters/1000).toFixed(1)} km. Förberedelse och återhämtning tillkommer. Retur-/vidareresa måste kontrolleras separat. Ingen tid har reserverats.</p>}
      <h4>Kontrollera hela mötesresan</h4><p>Start → {destination?.name||"mötesplats"} → {nextPlace?.name||"nästa plats"}. Välj även nästa plats om du ska åka tillbaka hem. Tider anges i {timezone}.</p>
      <div className="calendar-form-grid"><label>Mötet börjar<input type="datetime-local" value={meetingStart} onChange={e=>{setMeetingStart(e.target.value);setAssessment(null);}}/></label><label>Mötet slutar<input type="datetime-local" value={meetingEnd} onChange={e=>{setMeetingEnd(e.target.value);setAssessment(null);}}/></label><label>Senast framme på nästa plats<input type="datetime-local" value={nextArrival} onChange={e=>{setNextArrival(e.target.value);setAssessment(null);}}/></label></div>
      <button className="btn" disabled={busy||!origin||!destination||!nextPlace||!departure||!meetingStart||!meetingEnd||!nextArrival} onClick={()=>{try{setAssessment(null);void run({action:"travel_plan",plan:{start:zonedInstant(meetingStart,timezone),end:zonedInstant(meetingEnd,timezone),availableFrom:zonedInstant(departure,timezone),availableUntil:zonedInstant(nextArrival,timezone),originPlaceId:origin!.id,meetingPlaceId:destination!.id,nextPlaceId:nextPlace!.id,mode}});}catch{setError("Kontrollera samtliga datum och tider.");}}}>Kontrollera båda resorna och kalendern</button>
      {assessment&&<div className="calendar-notice" role="status"><strong>{({FEASIBLE:"Resorna ryms i det kontrollerade tidsfönstret",NOT_FEASIBLE:"Resorna ryms inte",TRAVEL_TIME_UNKNOWN:"Restidsunderlaget är ofullständigt eller för gammalt",CALENDAR_CONFLICT:"En bokning eller reservation överlappar resan",CALENDAR_REVIEW_REQUIRED:"Synkronisera, stäm av och välj en tid enligt dina planeringsregler"} as Record<string,string>)[assessment.status]??"Underlaget behöver granskas"}</strong>{assessment.inbound&&assessment.outbound&&<p>Till mötet: {assessment.inbound.minutes} min · Efter mötet: {assessment.outbound.minutes} min. Buffertar är medräknade separat.</p>}<p>Ingen bokning eller reservation har gjorts. Underlaget måste kontrolleras igen före bokning.</p></div>}
    </>}
  </details>;
}
