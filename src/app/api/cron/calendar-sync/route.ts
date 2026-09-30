import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { runCalendarSyncTick } from "@/lib/calendar/background-sync";

export const maxDuration=60;
/** Vercel invokes scheduled jobs with CRON_SECRET. The POST endpoint below is
 * also retained for the one-time, database-dispatched calendar runner. */
export async function GET(request:Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"))) return NextResponse.json({error:"Unauthorized"},{status:401});
  try {
    return NextResponse.json(await runCalendarSyncTick(createAdminClient()),{headers:{"Cache-Control":"no-store"}});
  }
  catch { return NextResponse.json({error:"Calendar background sync unavailable"},{status:503}); }
}

export async function POST(request:Request) {
  const authorization=request.headers.get("authorization");
  const token=authorization?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
  const legacy=process.env.CALENDAR_BACKGROUND_SYNC_ENABLED==="true"&&isAuthorizedCron(authorization,process.env.CALENDAR_SYNC_SECRET);
  if(!token&&!legacy)return NextResponse.json({error:"Unauthorized"},{status:401});
  try {
    const db=createAdminClient();
    if(!legacy) {
      const {data,error}=await db.rpc("consume_calendar_dispatch",{p_token:token});
      if(error||data!==true)return NextResponse.json({error:"Unauthorized"},{status:401});
    }
    return NextResponse.json(await runCalendarSyncTick(db),{headers:{"Cache-Control":"no-store"}});
  }
  catch {return NextResponse.json({error:"Calendar background sync unavailable"},{status:503});}
}
