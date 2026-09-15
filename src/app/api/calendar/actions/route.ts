import {NextResponse} from "next/server";
import {z} from "zod";
import {calendarSession} from "@/lib/calendar/auth";
import {eventActionRequest,prepareEventAction,executeEventAction} from "@/lib/calendar/event-actions";
export const maxDuration=60;
const schema=z.discriminatedUnion("action",[
 z.object({action:z.literal("prepare"),request:eventActionRequest}),
 z.object({action:z.literal("execute"),planId:z.string().uuid(),approved:z.literal(true)}),
]);
export async function POST(request:Request) {
 if(request.headers.get("origin")!==new URL(request.url).origin)return NextResponse.json({error:"Ogiltigt ursprung."},{status:403});
 const parsed=schema.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:"Kontrollera bokningsuppgifterna."},{status:400});
 try {
  const {db,owner}=await calendarSession(),a=parsed.data;
  return NextResponse.json(a.action==="prepare"?{plan:await prepareEventAction(db,owner,a.request)}:await executeEventAction(db,owner,a.planId),{headers:{"Cache-Control":"no-store"}});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Kalenderåtgärden misslyckades."},{status:409});}
}
