import {createHash} from "node:crypto";
import {NextResponse} from "next/server";
import {z} from "zod";
import {calendarSession} from "@/lib/calendar/auth";
import {analyzeCalendarIntent} from "@/lib/calendar/ai-intent";
export const maxDuration=45;
export async function GET() {
 try {
  const {db,owner}=await calendarSession();
  const {data,error}=await db.from("calendar_intent_proposals").select("id,conversation_id,proposal,status,created_at").eq("owner_id",owner).eq("status","proposed").order("created_at",{ascending:false}).limit(100);
  if(error)throw new Error("Förslagen kunde inte läsas.");
  return NextResponse.json({proposals:data},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Kalenderförslagen kunde inte hämtas."},{status:503});}
}
const action=z.discriminatedUnion("action",[z.object({action:z.literal("analyze"),conversationId:z.string().uuid()}),z.object({action:z.literal("dismiss"),proposalId:z.string().uuid()})]);
export async function POST(request:Request) {
 if(request.headers.get("origin")!==new URL(request.url).origin)return NextResponse.json({error:"Ogiltigt ursprung."},{status:403});
 const parsed=action.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:"Välj en konversation."},{status:400});
 try {
  const {db,owner}=await calendarSession(),a=parsed.data;
  if(a.action==="dismiss") {
   const {error}=await db.from("calendar_intent_proposals").update({status:"dismissed"}).eq("owner_id",owner).eq("id",a.proposalId);
   if(error)throw new Error("Förslaget kunde inte stängas.");
   return NextResponse.json({success:true});
  }
  const [conversation,messages,settings]=await Promise.all([
   db.from("conversations").select("id").eq("owner_id",owner).eq("id",a.conversationId).single(),
   db.from("messages").select("id,body_text,sent_at,direction,source").eq("owner_id",owner).eq("conversation_id",a.conversationId).order("sent_at",{ascending:false}).order("id").limit(12),
   db.from("calendar_workspace").select("timezone").eq("owner_id",owner).single(),
  ]);
  if(conversation.error||messages.error||settings.error||!messages.data?.length)throw new Error("Konversationens underlag kunde inte läsas.");
  const evidence=[...messages.data].reverse().map(m=>({id:m.id,body:(m.body_text??"").slice(0,2000),sentAt:m.sent_at,direction:m.direction,source:m.source}));
  const hash=createHash("sha256").update(JSON.stringify({evidence,timezone:settings.data.timezone,version:1})).digest("hex");
  const {data:existing,error:read}=await db.from("calendar_intent_proposals").select("*").eq("owner_id",owner).eq("conversation_id",a.conversationId).eq("input_hash",hash).maybeSingle();
  if(read)throw new Error("Tidigare analys kunde inte läsas.");
  if(existing)return NextResponse.json({proposal:existing,reused:true});
  const proposal=await analyzeCalendarIntent({ownerId:owner,timezone:settings.data.timezone,messages:evidence});
  const {data:saved,error:save}=await db.from("calendar_intent_proposals").upsert({owner_id:owner,conversation_id:a.conversationId,input_hash:hash,proposal,status:proposal.operation==="none"?"dismissed":"proposed"},{onConflict:"owner_id,conversation_id,input_hash",ignoreDuplicates:true}).select("*").maybeSingle();
  if(save)throw new Error("Förslaget kunde inte sparas.");
  if(!saved)throw new Error("Samma konversation analyserades samtidigt. Uppdatera för att se förslaget.");
  // Only a successfully persisted replacement supersedes previous proposals.
  const {error:supersede}=await db.from("calendar_intent_proposals").update({status:"dismissed"}).eq("owner_id",owner).eq("conversation_id",a.conversationId).neq("id",saved.id).eq("status","proposed");
  if(supersede)throw new Error("Förslaget är sparat men äldre förslag kunde inte stängas. Uppdatera vyn.");
  return NextResponse.json({proposal:saved});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Mötesanalysen misslyckades."},{status:409});}
}
