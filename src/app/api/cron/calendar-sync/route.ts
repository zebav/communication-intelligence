import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { runCalendarSyncTick } from "@/lib/calendar/background-sync";
import { logOperation } from "@/lib/observability";

export const maxDuration=60;
/** Vercel invokes scheduled jobs with CRON_SECRET. The POST endpoint below is
 * also retained for the one-time, database-dispatched calendar runner. */
export async function GET(request:Request) {
  const startedAt=Date.now();
  if (!isAuthorizedCron(request.headers.get("authorization"))) return NextResponse.json({error:"Unauthorized"},{status:401});
  try {
    const result=await runCalendarSyncTick(createAdminClient());
    logOperation({route:"/api/cron/calendar-sync",operation:"calendar_sync",outcome:"completed",durationMs:Date.now()-startedAt,requestId:request.headers.get("x-vercel-id"),traceId:request.headers.get("x-solvani-trace-id")});
    return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
  }
  catch (error) { logOperation({route:"/api/cron/calendar-sync",operation:"calendar_sync",outcome:"failed",durationMs:Date.now()-startedAt,requestId:request.headers.get("x-vercel-id"),traceId:request.headers.get("x-solvani-trace-id"),error}); return NextResponse.json({error:"Calendar background sync unavailable"},{status:503}); }
}

export async function POST(request:Request) {
  const startedAt=Date.now();
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
    const result=await runCalendarSyncTick(db);
    logOperation({route:"/api/cron/calendar-sync",operation:"calendar_sync_dispatch",outcome:"completed",durationMs:Date.now()-startedAt,requestId:request.headers.get("x-vercel-id"),traceId:request.headers.get("x-solvani-trace-id")});
    return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
  }
  catch(error){logOperation({route:"/api/cron/calendar-sync",operation:"calendar_sync_dispatch",outcome:"failed",durationMs:Date.now()-startedAt,requestId:request.headers.get("x-vercel-id"),traceId:request.headers.get("x-solvani-trace-id"),error});return NextResponse.json({error:"Calendar background sync unavailable"},{status:503});}
}
