import {NextResponse} from "next/server";
import {z} from "zod";
import {calendarSession} from "@/lib/calendar/auth";
import {eventActionRequest,prepareEventAction,executeEventAction} from "@/lib/calendar/event-actions";
import {GooglePlacesRoutes} from "@/lib/calendar/places-routing";
import {mapsEnabled,reserveMapsOperation} from "@/lib/calendar/maps-budget";
export const maxDuration=60;
const schema=z.discriminatedUnion("action",[
 z.object({action:z.literal("prepare"),request:eventActionRequest}),
 z.object({action:z.literal("execute"),planId:z.string().uuid(),approved:z.literal(true),approvedNotifications:z.boolean().optional()}),
 z.object({action:z.literal("dismiss"),planId:z.string().uuid()}),
]);
export async function GET(request:Request) {
 try {
  const {db,owner}=await calendarSession(),params=new URL(request.url).searchParams;
  const source=z.string().uuid().parse(params.get("sourceId")),event=z.string().min(1).max(2000).parse(params.get("eventId"));
  const {data,error}=await db.from("calendar_event_actions").select("*").eq("owner_id",owner).eq("source_id",source).eq("event_id",event).in("status",["proposed","executing"]).order("created_at",{ascending:false}).limit(20);
  if(error)throw error;
  return NextResponse.json({plans:data},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Sparade ändringsförslag kunde inte läsas."},{status:503});}
}
export async function POST(request:Request) {
 if(request.headers.get("origin")!==new URL(request.url).origin)return NextResponse.json({error:"Ogiltigt ursprung."},{status:403});
 const parsed=schema.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:"Kontrollera bokningsuppgifterna."},{status:400});
 try {
  const {db,owner}=await calendarSession(),a=parsed.data;
  if(a.action==="dismiss") {
   const {data,error}=await db.from("calendar_event_actions").update({status:"stale"}).eq("id",a.planId).eq("owner_id",owner).eq("status","proposed").select("id").maybeSingle();
   if(error||!data)throw new Error("Ett påbörjat ändringsförsök måste kontrolleras innan det kan stängas.");
   return NextResponse.json({dismissed:true});
  }
  const routes=mapsEnabled()?new GooglePlacesRoutes(process.env.GOOGLE_MAPS_SERVER_API_KEY!,fetch,reserveMapsOperation):undefined;
  return NextResponse.json(a.action==="prepare"?{plan:await prepareEventAction(db,owner,a.request,routes)}:await executeEventAction(db,owner,a.planId,a.approvedNotifications,routes),{headers:{"Cache-Control":"no-store"}});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Kalenderåtgärden misslyckades."},{status:409});}
}
