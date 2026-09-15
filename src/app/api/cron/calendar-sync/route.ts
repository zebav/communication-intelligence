import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { runCalendarSyncTick } from "@/lib/calendar/background-sync";

export const maxDuration=60;
export async function POST(request:Request) {
  if(!isAuthorizedCron(request.headers.get("authorization"),process.env.CALENDAR_SYNC_SECRET))return NextResponse.json({error:"Unauthorized"},{status:401});
  if(process.env.CALENDAR_BACKGROUND_SYNC_ENABLED!=="true")return NextResponse.json({status:"disabled"},{status:503});
  try {return NextResponse.json(await runCalendarSyncTick(createAdminClient()),{headers:{"Cache-Control":"no-store"}});}
  catch {return NextResponse.json({error:"Calendar background sync unavailable"},{status:503});}
}
