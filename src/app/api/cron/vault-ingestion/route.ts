import {NextRequest,NextResponse} from "next/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {isAuthorizedCron} from "@/lib/cron-auth";

export const maxDuration=300;

export async function GET(request:NextRequest){
 if(!isAuthorizedCron(request.headers.get("authorization")))return NextResponse.json({error:"Unauthorized."},{status:401});
 const db=createAdminClient();
 const {data:owners,error}=await db.from("vault_ingestion_jobs").select("owner_id").eq("state","pending").order("created_at").limit(25);
 if(error)return NextResponse.json({error:"Ingest owners could not be loaded."},{status:500});
 const unique=[...new Set((owners??[]).map(row=>String(row.owner_id)))];
 const origin=request.nextUrl.origin;
 const results=[];
 for(const ownerId of unique){
  try{
   const response=await fetch(`${origin}/api/vault/process-ingestion`,{
    method:"POST",
    headers:{authorization:`Bearer ${process.env.CRON_SECRET??""}`,"x-owner-id":ownerId},
    signal:AbortSignal.timeout(120_000),
   });
   const body=await response.json().catch(()=>({}));
   results.push({ownerId,status:response.status,...body});
  }catch{results.push({ownerId,status:599,error:"processor_failed"});}
 }
 return NextResponse.json({owners:unique.length,results});
}
