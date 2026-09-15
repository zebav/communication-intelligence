import { NextResponse } from "next/server";
import { z } from "zod";
import { calendarSession } from "@/lib/calendar/auth";
import { confirmHold,createMaster,discoverCalendars,syncCalendar } from "@/lib/calendar/service";
import { suggestSlots } from "@/lib/calendar/scheduling";
import { zonedInstant } from "@/lib/calendar/time";
import type { CalendarEvent,CalendarHold } from "@/lib/calendar/types";

export const maxDuration=60;
const uuid=z.string().uuid();
const action=z.discriminatedUnion("action",[
 z.object({action:z.literal("discover"),accountId:uuid}),
 z.object({action:z.literal("create_master"),accountId:uuid,timezone:z.string().min(1).max(100),approved:z.literal(true)}),
 z.object({action:z.literal("sync"),sourceId:uuid}),
 z.object({action:z.literal("review"),sourceId:uuid,syncedAt:z.string()}),
 z.object({action:z.literal("enabled"),sourceId:uuid,enabled:z.boolean()}),
 z.object({action:z.literal("suggest"),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),duration:z.number().int().min(5).max(600),preparation:z.number().int().min(0).max(180),recovery:z.number().int().min(0).max(180),physical:z.boolean()}),
 z.object({action:z.literal("hold"),title:z.string().trim().min(1).max(300),start:z.iso.datetime({offset:true}),end:z.iso.datetime({offset:true}),preparation:z.number().int().min(0).max(180),recovery:z.number().int().min(0).max(180),physical:z.literal(false),conversationId:uuid.nullable()}),
 z.object({action:z.literal("release"),holdId:uuid}),
 z.object({action:z.literal("confirm"),holdId:uuid,approved:z.literal(true)}),
]);
export async function GET() {
 try {
  const {db,owner}=await calendarSession();
  const results=await Promise.all([
   db.from("calendar_accounts").select("id,provider,address,scopes").eq("owner_id",owner),
   db.from("calendar_sources").select("*").eq("owner_id",owner).order("name"),
   db.from("calendar_workspace").select("timezone,provisioning").eq("owner_id",owner).maybeSingle(),
   db.from("calendar_holds").select("*").eq("owner_id",owner).gte("ends_at",new Date(Date.now()-86400000).toISOString()).order("starts_at").limit(300),
  ]);
  if(results.some(r=>r.error)) return NextResponse.json({error:"Kalenderns databas är inte tillgänglig ännu. Befintliga mejl och kontakter påverkas inte."},{status:503});
  return NextResponse.json({accounts:results[0].data,sources:results[1].data,workspace:results[2].data,holds:results[3].data},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Logga in med tvåfaktor för att öppna kalendern."},{status:401});}
}
export async function POST(request:Request) {
 if(request.headers.get("origin")!==new URL(request.url).origin) return NextResponse.json({error:"Ogiltigt ursprung"},{status:403});
 const parsed=action.safeParse(await request.json().catch(()=>null));
 if(!parsed.success) return NextResponse.json({error:"Kontrollera uppgifterna och godkänn åtgärden."},{status:400});
 try {
  const {db,owner}=await calendarSession(), a=parsed.data;
  if(a.action==="create_master") {
   new Intl.DateTimeFormat("sv-SE",{timeZone:a.timezone}).format();
   const {error}=await db.from("calendar_workspace").upsert({owner_id:owner},{onConflict:"owner_id",ignoreDuplicates:true});
   if(error) throw new Error("Kalenderns databas behöver installeras.");
   await createMaster(db,owner,a.accountId,a.timezone);
  }
  if(a.action==="discover") await discoverCalendars(db,owner,a.accountId);
  if(a.action==="sync") {
   const now=Date.now();
   await syncCalendar(db,owner,a.sourceId,{start:new Date(now-7*86400000).toISOString(),end:new Date(now+60*86400000).toISOString()});
  }
  if(a.action==="review") {
   const {data:s,error}=await db.from("calendar_sources").select("snapshot,synced_at,sync_error").eq("id",a.sourceId).eq("owner_id",owner).eq("is_master",false).single();
   if(error||!s||s.sync_error||s.synced_at!==a.syncedAt) throw new Error("Kalendern har ändrats. Hämta och granska den igen.");
   const {data:updated,error:save}=await db.from("calendar_sources").update({reviewed_snapshot:s.snapshot}).eq("id",a.sourceId).eq("owner_id",owner).eq("synced_at",a.syncedAt).select("id").maybeSingle();
   if(save||!updated) throw new Error("Avstämningen kunde inte sparas.");
  }
  if(a.action==="enabled") {
   const {error}=await db.from("calendar_sources").update({enabled:a.enabled}).eq("id",a.sourceId).eq("owner_id",owner).eq("is_master",false);
   if(error) throw new Error("Kalendervalet kunde inte sparas.");
  }
  if(a.action==="suggest") {
   const [settings,sources,holds]=await Promise.all([db.from("calendar_workspace").select("timezone").eq("owner_id",owner).single(),db.from("calendar_sources").select("*").eq("owner_id",owner).eq("enabled",true),db.from("calendar_holds").select("*").eq("owner_id",owner).gte("ends_at",new Date().toISOString()).limit(1000)]);
   if(settings.error||sources.error||holds.error) throw new Error("Kalenderunderlaget kunde inte läsas.");
   if(holds.data.length>=1000) throw new Error("För många reservationer för en säker bedömning.");
   const timezone=settings.data.timezone, start=zonedInstant(a.date+"T08:00",timezone),end=zonedInstant(a.date+"T21:00",timezone);
   const now=new Date().toISOString();
   const master=sources.data.find(s=>s.is_master);
   const syncFresh=Boolean(master)&&sources.data.every(s=>s.synced_at&&Date.parse(s.synced_at)>Date.now()-300000&&!s.sync_error&&Date.parse(s.window_start)<=Date.parse(start)&&Date.parse(s.window_end)>=Date.parse(end));
   const slots=suggestSlots({windows:[{start,end}],events:(master?.snapshot??[]) as CalendarEvent[],holds:holds.data.filter(h=>h.status!=="released").map(h=>({id:h.id,start:new Date(Date.parse(h.starts_at)-h.preparation_minutes*60000).toISOString(),end:new Date(Date.parse(h.ends_at)+h.recovery_minutes*60000).toISOString(),expiresAt:h.status==="active"?h.expires_at:"9999-01-01T00:00:00Z",status:"active",conversationId:h.conversation_id??""})) as CalendarHold[],preferences:{durationMinutes:a.duration,preparationMinutes:a.preparation,recoveryMinutes:a.recovery,stepMinutes:30,timezone},physical:a.physical,reconciled:sources.data.filter(s=>!s.is_master).every(s=>JSON.stringify(s.snapshot)===JSON.stringify(s.reviewed_snapshot)),syncFresh,now});
   return NextResponse.json({slots});
  }
  if(a.action==="hold") {
   const {error}=await db.from("calendar_holds").insert({owner_id:owner,title:a.title,starts_at:a.start,ends_at:a.end,preparation_minutes:a.preparation,recovery_minutes:a.recovery,conversation_id:a.conversationId});
   if(error) throw new Error("Reservationen kunde inte sparas: kontrollera synkronisering, avstämning och tidskonflikter.");
  }
  if(a.action==="release") {
   const {error}=await db.from("calendar_holds").update({status:"released"}).eq("owner_id",owner).eq("id",a.holdId).eq("status","active");
   if(error) throw new Error("Reservationen kunde inte släppas.");
  }
  if(a.action==="confirm") await confirmHold(db,owner,a.holdId);
  return NextResponse.json({success:true});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Kalenderåtgärden misslyckades."},{status:409});}
}
