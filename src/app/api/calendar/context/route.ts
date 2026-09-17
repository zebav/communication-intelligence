import {NextResponse} from "next/server";
import {z} from "zod";
import {calendarSession} from "@/lib/calendar/auth";
import {eventContextSchema} from "@/lib/calendar/event-context";
const noStore={"Cache-Control":"no-store"};
export async function GET(request:Request) {
 try {
  const {db,owner}=await calendarSession(),params=new URL(request.url).searchParams;
  const search=params.get("search");
  if(params.has("personId")) {
   const personId=z.string().uuid().parse(params.get("personId"));
   const merges=await db.from("contact_merges").select("source_id").eq("owner_id",owner).eq("target_id",personId).is("undone_at",null).limit(100);
   if(merges.error)throw merges.error;
   const contexts=await db.from("calendar_event_context").select("*").eq("owner_id",owner).overlaps("person_ids",[personId,...merges.data.map(m=>m.source_id)]).order("updated_at",{ascending:false}).limit(50);
   if(contexts.error)throw contexts.error;
   if(!contexts.data.length)return NextResponse.json({items:[]},{headers:noStore});
   const sources=await db.from("calendar_sources").select("id,name,snapshot").eq("owner_id",owner).in("id",[...new Set(contexts.data.map(c=>c.source_id))]);
   if(sources.error)throw sources.error;
   const items=contexts.data.map(c=>{const s=sources.data.find(s=>s.id===c.source_id),event=s?.snapshot?.find((e:{id:string})=>e.id===c.event_id);return {id:c.id,title:event?.title??"Kopplad kalenderbokning",start:event?.start??null,end:event?.end??null,timezone:event?.timezone??"UTC",source:s?.name??"Kalender",locationKind:c.location_kind,placeLabel:c.user_place_label,status:event?.status??"outside_snapshot"};});
   return NextResponse.json({items},{headers:noStore});
  }
  if(search!==null){
   const query=z.string().trim().min(2).max(100).parse(search).replace(/[\\%_]/g,"\\$&");
   const {data,error}=await db.from("people").select("id,display_name,organization").eq("owner_id",owner).ilike("display_name",`%${query}%`).order("display_name").limit(25);
   if(error)throw error;
   if(params.get("includeEmails")==="true"&&data.length){
    const identities=await db.from("identities").select("person_id,external_identifier").eq("owner_id",owner).eq("source","email").in("person_id",data.map(p=>p.id));
    if(identities.error)throw identities.error;
    return NextResponse.json({people:data.map(p=>({...p,emails:[...new Set(identities.data.filter(i=>i.person_id===p.id&&z.string().email().safeParse(i.external_identifier).success).map(i=>i.external_identifier.toLowerCase()))]}))},{headers:noStore});
   }
   return NextResponse.json({people:data},{headers:noStore});
  }
  const source=z.string().uuid().parse(params.get("sourceId")),event=z.string().min(1).max(2000).parse(params.get("eventId"));
  const {data,error}=await db.from("calendar_event_context").select("*").eq("owner_id",owner).eq("source_id",source).eq("event_id",event).maybeSingle();
  if(error)throw error;
  let people:unknown[]=[];
  if(data?.person_ids.length){const result=await db.from("people").select("id,display_name,organization").eq("owner_id",owner).in("id",data.person_ids);if(result.error)throw result.error;people=result.data;}
  return NextResponse.json({context:data,people},{headers:noStore});
 }catch{return NextResponse.json({error:"Bokningens kontakt- och platsuppgifter kunde inte hämtas."},{status:503});}
}
export async function POST(request:Request) {
 if(request.headers.get("origin")!==new URL(request.url).origin)return NextResponse.json({error:"Ogiltigt ursprung."},{status:403});
 const parsed=eventContextSchema.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:"Kontrollera kontakter, plats och möteslänk."},{status:400});
 try {
  const {db,owner}=await calendarSession(),a=parsed.data;
  // A place ID is a user-selected reference, not proof of current address or travel feasibility.
  // Store no Google-provided names/addresses. user_place_label is explicitly user-authored.
  const record={owner_id:owner,source_id:a.sourceId,event_id:a.eventId,person_ids:a.personIds,conversation_id:a.conversationId,location_kind:a.locationKind,google_place_id:a.googlePlaceId,user_place_label:a.userPlaceLabel,meeting_url:a.meetingUrl,revision:a.revision+1};
  const table=db.from("calendar_event_context");
  const result=a.revision===0?await table.insert(record).select("*").single():await table.update(record).eq("owner_id",owner).eq("source_id",a.sourceId).eq("event_id",a.eventId).eq("revision",a.revision).select("*").maybeSingle();
  if(result.error||!result.data)throw new Error("Uppgifterna kunde inte sparas eller har ändrats i en annan vy. Ladda om bokningen innan du försöker igen.");
  return NextResponse.json({context:result.data},{headers:noStore});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Kopplingarna kunde inte sparas."},{status:409});}
}
