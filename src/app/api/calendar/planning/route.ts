import { NextResponse } from "next/server";
import { z } from "zod";
import { calendarSession } from "@/lib/calendar/auth";
import { defaultPlanningPreferences, planningPreferencesSchema } from "@/lib/calendar/planning-preferences";
import { GooglePlacesRoutes, routeRequestSchema } from "@/lib/calendar/places-routing";

export const maxDuration = 30;
const action = z.discriminatedUnion("action", [
  z.object({action:z.literal("preferences"),rules:planningPreferencesSchema}),
  z.object({action:z.literal("places"),query:z.string().trim().min(3).max(300)}),
  z.object({action:z.literal("route"),route:routeRequestSchema}),
]);
const mapsEnabled = () => process.env.CALENDAR_MAPS_ENABLED === "true" && Boolean(process.env.GOOGLE_MAPS_SERVER_API_KEY);
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
    const service = new GooglePlacesRoutes(process.env.GOOGLE_MAPS_SERVER_API_KEY!);
    return NextResponse.json(a.action === "places" ? {places:await service.search(a.query)} : {route:await service.estimate(a.route)}, {headers:{"Cache-Control":"no-store"}});
  } catch { return NextResponse.json({error:"Planeringsåtgärden kunde inte slutföras. Inga kalenderbokningar har ändrats."},{status:409}); }
}
