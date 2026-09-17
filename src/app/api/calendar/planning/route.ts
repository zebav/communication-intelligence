import { NextResponse } from "next/server";
import { z } from "zod";
import { calendarSession } from "@/lib/calendar/auth";
import { defaultPlanningPreferences, planningPreferencesSchema } from "@/lib/calendar/planning-preferences";
import { GooglePlacesRoutes, MapsProviderError, routeRequestSchema } from "@/lib/calendar/places-routing";
import {travelPlanRequest} from "@/lib/calendar/travel-plan";
import {calendarTravelAssessment} from "@/lib/calendar/travel-service";
import {mapsEnabled,MapsBudgetError,reserveMapsOperation} from "@/lib/calendar/maps-budget";
import {GoogleWeather,weatherRequestSchema} from "@/lib/calendar/weather";

export const maxDuration = 30;
const action = z.discriminatedUnion("action", [
  z.object({action:z.literal("preferences"),rules:planningPreferencesSchema}),
  z.object({action:z.literal("places"),query:z.string().trim().min(3).max(300)}),
  z.object({action:z.literal("route"),route:routeRequestSchema}),
  z.object({action:z.literal("travel_plan"),plan:travelPlanRequest}),
  z.object({action:z.literal("weather"),weather:weatherRequestSchema}),
  z.object({action:z.literal("map")}),
]);
export async function GET() {
  try {
    const {db,owner} = await calendarSession();
    const {data,error} = await db.from("calendar_planning_preferences").select("rules").eq("owner_id",owner).maybeSingle();
    if(error) return NextResponse.json({error:"Planeringsreglernas databas är inte installerad eller kunde inte läsas."},{status:503});
    return NextResponse.json({rules:data ? planningPreferencesSchema.parse(data.rules) : defaultPlanningPreferences,mapsEnabled:mapsEnabled()}, {headers:{"Cache-Control":"no-store"}});
  } catch { return NextResponse.json({error:"Planeringen kunde inte läsas. Kontrollera inloggningen."},{status:401}); }
}
export async function POST(request:Request) {
  if(request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({error:"Ogiltigt ursprung."},{status:403});
  const parsed = action.safeParse(await request.json().catch(()=>null));
  if(!parsed.success) return NextResponse.json({error:"Kontrollera planeringsuppgifterna."},{status:400});
  try {
    const {db,owner} = await calendarSession(), a = parsed.data;
    if(a.action === "preferences") {
      const {data,error} = await db.from("calendar_planning_preferences").upsert({owner_id:owner,rules:a.rules,updated_at:new Date().toISOString()}).select("rules").single();
      if(error || !data) throw new Error("Reglerna kunde inte sparas.");
      return NextResponse.json({rules:planningPreferencesSchema.parse(data.rules)});
    }
    if(!mapsEnabled()) return NextResponse.json({error:"Google Maps är förberett men inte aktiverat. Kostnader och nyckel måste godkännas först."},{status:503});
    if(a.action==="map"){
      // Browser credentials can be reused outside our server-side request counter.
      // Do not enable until the separate browser-key cost controls are approved.
      if(process.env.CALENDAR_BROWSER_MAPS_ENABLED!=="true")return NextResponse.json({error:"Den interaktiva kartan väntar på separat verifiering av kostnadsskyddet. Du kan fortfarande öppna platsen i Google Maps."},{status:503});
      // This browser key is intentionally public, unlike the server API key.
      const key=process.env.GOOGLE_MAPS_BROWSER_API_KEY;
      if(!key)return NextResponse.json({error:"Kartnyckeln är inte konfigurerad."},{status:503});
      await reserveMapsOperation("map");
      return NextResponse.json({browserKey:key},{headers:{"Cache-Control":"no-store"}});
    }
    if(a.action==="weather")return NextResponse.json({weather:await new GoogleWeather(process.env.GOOGLE_MAPS_SERVER_API_KEY!,()=>reserveMapsOperation("weather")).forecast(a.weather)},{headers:{"Cache-Control":"no-store"}});
    const service = new GooglePlacesRoutes(process.env.GOOGLE_MAPS_SERVER_API_KEY!,fetch,reserveMapsOperation);
    if(a.action==="travel_plan")return NextResponse.json({assessment:await calendarTravelAssessment(db,owner,a.plan,service)},{headers:{"Cache-Control":"no-store"}});
    return NextResponse.json(a.action === "places" ? {places:await service.search(a.query)} : {route:await service.estimate(a.route)}, {headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    console.error("calendar_planning_failed", {action:parsed.data.action,
      code:error instanceof MapsProviderError?error.code:error instanceof MapsBudgetError?"MAPS_BUDGET":error instanceof z.ZodError?"INVALID_PROVIDER_RESPONSE":"UNEXPECTED",
      ...(error instanceof MapsProviderError?{providerStatus:error.httpStatus}:{})});
    return NextResponse.json({error:error instanceof MapsBudgetError||error instanceof MapsProviderError?error.message:"Planeringsåtgärden kunde inte slutföras. Inga kalenderbokningar har ändrats."},{status:error instanceof MapsBudgetError?429:error instanceof MapsProviderError?502:409});
  }
}
