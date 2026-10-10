import {NextRequest,NextResponse} from "next/server";
import {decryptCredential} from "@/lib/connectors/credential-crypto";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {isAuthorizedCron} from "@/lib/cron-auth";
import {ingestTrustedMediaAttachments, processEmailMediaJob, type MediaJob} from "@/lib/media/email-worker";
import {instagramConnector} from "@/lib/connectors/instagram";
import {downloadEphemeralInstagramMedia} from "@/lib/connectors/instagram-media";
import {z} from "zod";
import {mediaFailureUpdate} from "@/lib/media/ingestion-lifecycle";

export const maxDuration=120;
type Credentials={accessToken:string};

async function owner(request:NextRequest){
 const background=isAuthorizedCron(request.headers.get("authorization"));
 const ownerHeader=z.string().uuid().safeParse(request.headers.get("x-owner-id"));
 if(background)return ownerHeader.success?{id:ownerHeader.data,background:true}:null;
 if(request.headers.get("origin")!==request.nextUrl.origin)return null;
 const db=await createClient(); const {data:{user}}=await db.auth.getUser(); if(!user)return null;
 const {data:aal}=await db.auth.mfa.getAuthenticatorAssuranceLevel(); if(aal?.currentLevel!=="aal2")return null;
 return {id:user.id,background:false};
}
type Attachment={name:string;mime:string;bytes:Uint8Array;isInline?:boolean;contentId?:string;contentDisposition?:string};

async function fetchExternalMedia(url:string,apiKey?:string):Promise<Attachment[]>{
 const parsed=new URL(url);
 if(parsed.protocol!=="https:"||parsed.username||parsed.password||(parsed.port&&parsed.port!=="443"))throw new Error("unsafe_media_url");
 // YCloud's signed webhook URLs are intentionally short-lived. Its API key is
 // required to retrieve the same private media later (up to 30 days), which is
 // exactly when the background ingest worker normally runs.
 if(apiKey&&parsed.hostname!=="api.ycloud.com")throw new Error("unsafe_ycloud_media_host");
 const r=await fetch(parsed.href,{redirect:"error",signal:AbortSignal.timeout(30_000),headers:{accept:"image/*,video/*,audio/*,application/pdf,application/octet-stream",...(apiKey?{"x-api-key":apiKey}:{})}});
 if(!r.ok)throw new Error(`media_fetch_${r.status}`);
 const length=Number(r.headers.get("content-length")??0); if(length>100*1024*1024)throw new Error("media_too_large");
 const mime=(r.headers.get("content-type")??"application/octet-stream").split(";")[0].trim();
 const bytes=new Uint8Array(await r.arrayBuffer()); if(bytes.length>100*1024*1024)throw new Error("media_too_large");
 const name=decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop()??"media").slice(0,180)||"media";
 return [{name,mime,bytes}];
}
async function metaWhatsAppMedia(token:string,mediaId:string,metadata:Record<string,unknown>):Promise<Attachment[]>{
 const lookup=await fetch(`https://graph.facebook.com/v23.0/${encodeURIComponent(mediaId)}`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20_000)});
 if(!lookup.ok)throw new Error(`whatsapp_media_lookup_${lookup.status}`);
 const info=await lookup.json() as {url?:string;mime_type?:string;file_size?:number};
 if(!info.url||(info.file_size??0)>100*1024*1024)throw new Error("whatsapp_media_missing");
 const raw=await fetch(info.url,{headers:{authorization:`Bearer ${token}`},redirect:"error",signal:AbortSignal.timeout(30_000)});
 if(!raw.ok)throw new Error(`whatsapp_media_fetch_${raw.status}`);
 const bytes=new Uint8Array(await raw.arrayBuffer()); if(bytes.length>100*1024*1024)throw new Error("media_too_large");
 return [{name:typeof metadata.media_filename==="string"&&metadata.media_filename?metadata.media_filename:`whatsapp-${mediaId}`,mime:info.mime_type||String(metadata.media_mime_type||"application/octet-stream"),bytes}];
}

export async function POST(request:NextRequest){
 const actor=await owner(request); if(!actor)return NextResponse.json({error:"MFA eller giltig bakgrundsauktorisering krävs."},{status:403});
 const db=createAdminClient(); const key=process.env.CREDENTIAL_ENCRYPTION_KEY; if(!key)return NextResponse.json({error:"Krypteringsnyckel saknas."},{status:503});
 // Fresh social media is time-sensitive. Do not let one large email backfill
 // monopolise every batch and leave a newly received video permanently queued.
 const {data:queued,error}=await db.from("vault_ingestion_jobs").select("*").eq("owner_id",actor.id).eq("state","pending").order("updated_at",{ascending:false}).limit(40);
 if(error)return NextResponse.json({error:"Ingest-kön kunde inte läsas."},{status:500});
 const mediaPriority=(job:{source_type?:string;attempts?:number;updated_at?:string})=>job.source_type==="whatsapp"||job.source_type==="instagram"?0:1;
 const jobs=[...(queued??[])].sort((left,right)=>mediaPriority(left)-mediaPriority(right)||Number(left.attempts??0)-Number(right.attempts??0)||String(right.updated_at??"").localeCompare(String(left.updated_at??""))).slice(0,10);
 let processed=0,saved=0,failed=0; const skipped=0;
 for(const job of jobs??[]){
  // Email attachments have one canonical worker. Keeping token refresh,
  // provider retrieval, storage and idempotency in that module prevents the
  // background route and the connector worker from drifting into incompatible
  // Microsoft Graph requests.
  if(job.provider==="microsoft-graph"||job.provider==="gmail"){
   try{
    const outcome=await processEmailMediaJob(db,job as MediaJob);
    if(outcome.processed){processed++;saved+=outcome.assetCount??0;}
   }catch{failed++;}
   continue;
  }
  const {data:claimed}=await db.from("vault_ingestion_jobs").update({state:"processing",attempts:Number(job.attempts??0)+1,retrieval_status:"fetching",analysis_status:"processing",updated_at:new Date().toISOString()}).eq("id",job.id).eq("owner_id",actor.id).eq("state","pending").select("id").maybeSingle(); if(!claimed)continue;
  try{
   const {data:conn}=await db.from("connections").select("id,provider,encrypted_credentials").eq("owner_id",actor.id).eq("id",job.connection_id).single();
   if(!conn?.encrypted_credentials)throw new Error("connection_missing");
   const original=decryptCredential<Credentials>(conn.encrypted_credentials,key); const files:Attachment[]=[]; let sourceType:"email"|"whatsapp"|"instagram"="email";
   if(conn.provider===instagramConnector.id){
     sourceType="instagram";
     const {data:refs}=await db.from("vault_media_references").select("media_reference").eq("owner_id",actor.id).eq("connection_id",conn.id).eq("source","instagram").eq("provider_message_id",job.provider_message_id);
     const urls=(refs??[]).flatMap(ref=>typeof ref.media_reference==="string"?[ref.media_reference]:[]);
     if(urls.length) files.push(...(await downloadEphemeralInstagramMedia(urls, "instagram-media")).map((item) => ({ name: item.filename, mime: item.mimeType, bytes: new Uint8Array(item.bytes) })));
   }
   else if(conn.provider==="whatsapp-business"){
     sourceType="whatsapp";
     const provider=String(job.provider??"").replace(/^whatsapp:/,"");
     const {data:refs}=await db.from("vault_media_references").select("media_reference,mime_type,filename").eq("owner_id",actor.id).eq("connection_id",conn.id).eq("source","whatsapp").eq("provider",provider).eq("provider_message_id",job.provider_message_id);
     for(const ref of refs??[]){
       if(provider==="ycloud"&&typeof ref.media_reference==="string"&&ref.media_reference.startsWith("https://")){
        const apiKey=process.env.YCLOUD_API_KEY?.trim();
        if(!apiKey)throw new Error("ycloud_api_key_missing");
        files.push(...await fetchExternalMedia(ref.media_reference,apiKey));
       }
       else if(provider==="meta-direct"&&typeof ref.media_reference==="string"&&ref.media_reference)files.push(...await metaWhatsAppMedia(original.accessToken,ref.media_reference,{media_mime_type:ref.mime_type,media_filename:ref.filename}));
     }
     if(!files.length)throw new Error("whatsapp_media_reference_missing");
   }
   else throw new Error("unsupported_provider");
   const outcome=await ingestTrustedMediaAttachments(db,{...job,source_type:sourceType,attempts:Number(job.attempts??0)} as MediaJob,files.map(file=>({filename:file.name,mimeType:file.mime,bytes:Buffer.from(file.bytes)})));
   saved+=outcome.assetCount;
   await db.from("vault_ingestion_jobs").update({state:"done",retrieval_status:"available",analysis_status:outcome.state==="ready"?"completed":"blocked",vault_status:outcome.assetCount>0?"retained":"rejected",last_error_code:null,failed_stage:null,error_details:{},next_retry_at:null,completed_at:new Date().toISOString(),dead_lettered_at:null,updated_at:new Date().toISOString()}).eq("id",job.id).eq("owner_id",actor.id);processed++;
  }catch(e){failed++;await db.from("vault_ingestion_jobs").update(mediaFailureUpdate(e,Number(job.attempts??0)+1)).eq("id",job.id).eq("owner_id",actor.id);}
 }
 return NextResponse.json({processed,saved,skipped,failed,more:(queued??[]).length>jobs.length});
}
