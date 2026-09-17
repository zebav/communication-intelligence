import type {SupabaseClient} from "@supabase/supabase-js";
import {assessTravelPlan,type TravelPlanRequest} from "./travel-plan";
import type {RouteService} from "./places-routing";
import {calendarSuggestions} from "./suggestions-service";
import type {CalendarEvent} from "./types";

export async function calendarTravelAssessment(db:SupabaseClient,owner:string,input:TravelPlanRequest,provider:RouteService,excludeHoldId?:string) {
 const [settings,sources,holds]=await Promise.all([
  db.from("calendar_workspace").select("timezone").eq("owner_id",owner).single(),
  db.from("calendar_sources").select("*").eq("owner_id",owner).eq("enabled",true),
  db.from("calendar_holds").select("*").eq("owner_id",owner).gte("ends_at",input.availableFrom).lte("starts_at",input.availableUntil).limit(1000),
 ]);
 if(settings.error||sources.error||holds.error||holds.data.length>=1000)throw new Error("Hela kalenderunderlaget kunde inte läsas för reseplaneringen.");
 const date=new Intl.DateTimeFormat("sv-SE",{timeZone:settings.data.timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(input.start));
 const checked=await calendarSuggestions(db,owner,{date,duration:(Date.parse(input.end)-Date.parse(input.start))/60000,preparation:0,recovery:0,physical:false,requestedStart:input.start},excludeHoldId);
 const now=new Date().toISOString(),master=sources.data.find(s=>s.is_master);
 const calendarReady=Boolean(master)&&sources.data.every(s=>s.synced_at&&Date.parse(s.synced_at)>Date.now()-300000&&!s.sync_error&&s.window_start&&s.window_end&&Date.parse(s.window_start)<=Date.parse(input.availableFrom)&&Date.parse(s.window_end)>=Date.parse(input.availableUntil))&&checked.slots.some(s=>s.bookable&&Date.parse(s.start)===Date.parse(input.start)&&Date.parse(s.end)===Date.parse(input.end));
 const busy=[...(master?.snapshot??[] as CalendarEvent[]).filter((e:CalendarEvent)=>e.blocksAvailability&&e.status!=="cancelled"),
  ...holds.data.filter(h=>h.id!==excludeHoldId&&(h.status==="executing"||h.status==="confirmed"||(h.status==="active"&&Date.parse(h.expires_at)>Date.now()))).map(h=>({start:new Date(Date.parse(h.starts_at)-h.preparation_minutes*60000).toISOString(),end:new Date(Date.parse(h.ends_at)+h.recovery_minutes*60000).toISOString()}))];
 return assessTravelPlan(input,provider,{now,preparation:checked.preparation,recovery:checked.recovery,busy,calendarReady});
}
