import { NextResponse } from "next/server";
import { z } from "zod";
import { calendarSession } from "@/lib/calendar/auth";
import { confirmHold,createMaster,discoverCalendars,syncCalendar } from "@/lib/calendar/service";
import { calendarSuggestions } from "@/lib/calendar/suggestions-service";
import { transferCommitment } from "@/lib/calendar/commitment-transfer";

export const maxDuration=60;
const uuid=z.string().uuid();
const action=z.discriminatedUnion("action",[
 z.object({action:z.literal("discover"),accountId:uuid}),
 z.object({action:z.literal("create_master"),accountId:uuid,timezone:z.string().min(1).max(100),approved:z.literal(true)}),
 z.object({action:z.literal("sync"),sourceId:uuid}),
 z.object({action:z.literal("transfer"),sourceId:uuid,eventId:z.string().min(1).max(2000),fingerprint:z.string().min(1).max(10000),approved:z.literal(true)}),
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
  if(a.action==="transfer") await transferCommitment(db,owner,a.sourceId,a.eventId,a.fingerprint);
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
   return NextResponse.json(await calendarSuggestions(db,owner,a));
  }
  if(a.action==="hold") {
   const {data:settings,error:read}=await db.from("calendar_workspace").select("timezone").eq("owner_id",owner).single();
   if(read||!settings) throw new Error("Kalenderns tidszon kunde inte läsas.");
   const date=new Intl.DateTimeFormat("sv-SE",{timeZone:settings.timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(a.start));
   const checked=await calendarSuggestions(db,owner,{date,duration:(Date.parse(a.end)-Date.parse(a.start))/60000,preparation:a.preparation,recovery:a.recovery,physical:false});
   if(!checked.slots.some(s=>s.bookable&&Date.parse(s.start)===Date.parse(a.start)&&Date.parse(s.end)===Date.parse(a.end))||a.preparation<checked.preparation||a.recovery<checked.recovery) throw new Error("Tiden följer inte dina aktuella planeringsregler. Ta fram nya tidsförslag.");
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
