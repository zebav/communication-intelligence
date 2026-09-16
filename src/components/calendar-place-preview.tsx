"use client";
import {useEffect,useRef,useState} from "react";
import Script from "next/script";
import type {PlaceCandidate} from "@/lib/calendar/places-routing";
import type {WeatherAdvice} from "@/lib/calendar/weather";

type MapInstance={panTo:(p:{lat:number;lng:number})=>void};
type MapsWindow=Window&{google?:{maps:{Map:new(el:HTMLElement,options:Record<string,unknown>)=>MapInstance}}};
export function CalendarPlacePreview({place,at}:{place:PlaceCandidate;at?:string}) {
 const [key,setKey]=useState(""),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [weather,setWeather]=useState<WeatherAdvice|null>(null),[weatherFor,setWeatherFor]=useState("");
 const element=useRef<HTMLDivElement>(null),map=useRef<MapInstance|null>(null);
 const latitude=place.location?.latitude,longitude=place.location?.longitude;
 useEffect(()=>{
  const maps=(window as MapsWindow).google?.maps;
  if(!ready||!maps||!element.current||latitude===undefined||longitude===undefined)return;
  const center={lat:latitude,lng:longitude};
  if(map.current)map.current.panTo(center);
  else map.current=new maps.Map(element.current,{center,zoom:16,streetViewControl:false,mapTypeControl:false,fullscreenControl:true,gestureHandling:"cooperative"});
 },[ready,latitude,longitude]);
 const run=async(action:"map"|"weather")=>{
  if(!place.location)return;
  setBusy(true);setError("");
  try{
   const r=await fetch("/api/calendar/planning",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(action==="map"?{action}:{action,weather:{...place.location,at}})});
   const data=await r.json();if(!r.ok)throw new Error(data.error);
   if(data.browserKey)setKey(data.browserKey);
   if(data.weather){setWeather(data.weather);setWeatherFor(`${place.id}:${at}`);}
  }catch(e){setError(e instanceof Error?e.message:"Kartunderlaget kunde inte hämtas.");}finally{setBusy(false);}
 };
 if(!place.location)return <p>Platsen saknar koordinater. Ingen karta eller väderbedömning visas.</p>;
 return <section className="calendar-place-preview" aria-label="Karta och väder för vald plats">
  <h4>{place.name}</h4><p>{place.address}</p>
  <p>Platsen visas i kartans mitt. Karta och väder hämtas först när du väljer det. Platsuppgifter skickas då till Google.</p>
  {error&&<p role="alert">{error}</p>}
  {!key&&<button className="btn" disabled={busy} onClick={()=>run("map")}>Visa karta i kalendern</button>}
  {key&&<><Script id="calendar-google-maps" src={`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=quarterly&language=sv`} onReady={()=>setReady(true)} onError={()=>setError("Kartan kunde inte laddas. Kontrollera kartnyckelns webbplatsbegränsning och kvot.")}/><div ref={element} style={{height:320,minWidth:0,width:"100%",borderRadius:12}} aria-label={`Karta centrerad på ${place.name}`}/></>}
  <a href={place.mapsUrl} target="_blank" rel="noopener noreferrer">Öppna platsen i Google Maps</a>
  <p className="gmp-attribution" translate="no">Google Maps</p>
  {at?<button className="btn" disabled={busy} onClick={()=>run("weather")}>Kontrollera väder för mötestiden</button>:<p>Välj mötestid för väderunderlag.</p>}
  {weather&&weatherFor===`${place.id}:${at}`&&<div role="status" className="calendar-notice">
   <strong>{weather.available?weather.description||"Väderprognos":"Prognos saknas"}</strong>
   {weather.available&&<p>Dygnstemperatur: {weather.minC??"?"}–{weather.maxC??"?"} °C · Nederbördsrisk för tidsperioden: {weather.rainPercent??"okänd"}% · Vind: {weather.windKph??"okänd"} km/h</p>}
   <p>{weather.advice}</p><small>Hämtad {new Date(weather.checkedAt).toLocaleString("sv-SE")}. Prognos, inte garanti. Ingen bokning har ändrats.</small>
   <p className="gmp-attribution" translate="no">Source: Includes weather data from Google</p>
   <p className="gmp-attribution" translate="no">Includes data from Google Maps</p>
  </div>}
 </section>;
}
