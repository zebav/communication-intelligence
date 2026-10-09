import {NextRequest,NextResponse} from "next/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {isAuthorizedCron} from "@/lib/cron-auth";
import {mediaFailureUpdate} from "@/lib/media/ingestion-lifecycle";
import {logOperation} from "@/lib/observability";

export const maxDuration=300;

function transientFailure(reason: unknown) {
 const value=typeof reason==="string"?reason:"";
 // A YCloud media URL may initially fail because the earlier worker did not
 // attach the provider credential. It is safe to retry that bounded failure:
 // the updated worker now authenticates the download and never exposes bytes.
 return value==="vault_upload_failed"||value==="credential_update_failed"||value==="outlook_attachments_400"||value==="document_analysis_400_invalid_value"||/^media_fetch_(401|403|429|5\d\d)$/.test(value)||/(gmail_|outlook_attachments_|graph_attachments_).*(429|5\d\d)$/.test(value);
}

export async function GET(request:NextRequest){
 const startedAt=Date.now();
 if(!isAuthorizedCron(request.headers.get("authorization")))return NextResponse.json({error:"Unauthorized."},{status:401});
 const db=createAdminClient();
 // A function can end after claiming a job. Reclaim only stale work, and retry
 // only clearly transient download/storage failures. Reconnect and unsupported
 // file errors deliberately remain visible for the owner instead of looping.
 const staleAt=new Date(Date.now()-20*60_000).toISOString();
 const {data:stale}=await db.from("vault_ingestion_jobs").select("id,attempts").eq("state","processing").lt("updated_at",staleAt).limit(25);
 const staleIds=(stale??[]).map(row=>String(row.id));
 for(const job of stale??[]) await db.from("vault_ingestion_jobs").update(mediaFailureUpdate(new Error("processing_timeout"),Number(job.attempts??0))).eq("id",job.id).eq("state","processing");
 const {data:failed}=await db.from("vault_ingestion_jobs").select("id,last_error_code,attempts,next_retry_at").eq("state","failed").lt("attempts",3).lte("next_retry_at",new Date().toISOString()).limit(25);
 const retryIds=(failed??[]).filter(job=>transientFailure(job.last_error_code)).map(job=>String(job.id));
 if(retryIds.length)await db.from("vault_ingestion_jobs").update({state:"pending",next_retry_at:null,updated_at:new Date().toISOString()}).in("id",retryIds).eq("state","failed");
 const {data:owners,error}=await db.from("vault_ingestion_jobs").select("owner_id").eq("state","pending").order("created_at").limit(25);
 if(error){logOperation({route:"/api/cron/vault-ingestion",operation:"vault_ingestion",outcome:"failed",durationMs:Date.now()-startedAt,requestId:request.headers.get("x-vercel-id"),traceId:request.headers.get("x-solvani-trace-id"),error:"pending_owners_unavailable"});return NextResponse.json({error:"Ingest owners could not be loaded."},{status:500});}
 const unique=[...new Set((owners??[]).map(row=>String(row.owner_id)))];
 const origin=request.nextUrl.origin;
 const results=[];
 for(const ownerId of unique){
  try{
   // Keep the recovery bounded inside the runtime budget. The processor takes
   // a larger batch, while the live webhook still triggers it immediately for
   // newly received WhatsApp media.
   const response=await fetch(`${origin}/api/vault/process-ingestion`,{
     method:"POST",
     headers:{authorization:`Bearer ${process.env.CRON_SECRET??""}`,"x-owner-id":ownerId},
     signal:AbortSignal.timeout(50_000),
   });
   const body=await response.json().catch(()=>({}));
   results.push({ownerId,status:response.status,...body});
  }catch{results.push({ownerId,status:599,error:"processor_failed"});}
 }
 const failedProcessors=results.filter((result)=>result.status>=400).length;
 logOperation({route:"/api/cron/vault-ingestion",operation:"vault_ingestion",outcome:failedProcessors?"failed":"completed",durationMs:Date.now()-startedAt,requestId:request.headers.get("x-vercel-id"),traceId:request.headers.get("x-solvani-trace-id"),counts:{owners:unique.length,recovered_stale:staleIds.length,retried:retryIds.length,failed:failedProcessors}});
 return NextResponse.json({owners:unique.length,recovered:{stale:staleIds.length,retried:retryIds.length},results});
}
