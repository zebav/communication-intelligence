import {NextRequest,NextResponse} from "next/server";
import {decryptCredential,encryptCredential} from "@/lib/connectors/credential-crypto";
import {googleConfig} from "@/lib/connectors/google-oauth";
import {googleGmailConnector} from "@/lib/connectors/google-gmail";
import {microsoftConfig} from "@/lib/connectors/microsoft-oauth";
import {microsoftGraphConnector} from "@/lib/connectors/microsoft-graph";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {isAuthorizedCron} from "@/lib/cron-auth";
import {storeVaultFile} from "@/lib/vault/vault-service";
import {z} from "zod";

export const maxDuration=120;
type Credentials={accessToken:string;refreshToken?:string;expiresAt:string;tokenType?:string;scope?:string};

async function owner(request:NextRequest){
 const background=isAuthorizedCron(request.headers.get("authorization"));
 const ownerHeader=z.string().uuid().safeParse(request.headers.get("x-owner-id"));
 if(background)return ownerHeader.success?{id:ownerHeader.data,background:true}:null;
 if(request.headers.get("origin")!==request.nextUrl.origin)return null;
 const db=await createClient(); const {data:{user}}=await db.auth.getUser(); if(!user)return null;
 const {data:aal}=await db.auth.mfa.getAuthenticatorAssuranceLevel(); if(aal?.currentLevel!=="aal2")return null;
 return {id:user.id,background:false};
}
async function refreshMicrosoft(credentials:Credentials,origin:string){
 if(Date.parse(credentials.expiresAt)>Date.now()+60_000)return credentials;
 if(!credentials.refreshToken)throw new Error("reconnect_required");
 const cfg=microsoftConfig(origin);
 const r=await fetch(`https://login.microsoftonline.com/${cfg.tenant}/oauth2/v2.0/token`,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:cfg.clientId,client_secret:cfg.clientSecret,grant_type:"refresh_token",refresh_token:credentials.refreshToken,scope:microsoftGraphConnector.scopes.join(" ")}),signal:AbortSignal.timeout(15_000)});
 if(!r.ok)throw new Error("reconnect_required"); const t=await r.json() as {access_token?:string;refresh_token?:string;expires_in?:number;token_type?:string;scope?:string};
 if(!t.access_token||!t.expires_in)throw new Error("reconnect_required");
 return {...credentials,accessToken:t.access_token,refreshToken:t.refresh_token??credentials.refreshToken,expiresAt:new Date(Date.now()+t.expires_in*1000).toISOString(),tokenType:t.token_type??credentials.tokenType,scope:t.scope??credentials.scope};
}
async function refreshGoogle(credentials:Credentials,origin:string){
 if(Date.parse(credentials.expiresAt)>Date.now()+60_000)return credentials;
 if(!credentials.refreshToken)throw new Error("reconnect_required");
 const cfg=googleConfig(origin);
 const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:cfg.clientId,client_secret:cfg.clientSecret,grant_type:"refresh_token",refresh_token:credentials.refreshToken}),signal:AbortSignal.timeout(15_000)});
 if(!r.ok)throw new Error("reconnect_required"); const t=await r.json() as {access_token?:string;expires_in?:number;refresh_token?:string};
 if(!t.access_token||!t.expires_in)throw new Error("reconnect_required");
 return {...credentials,accessToken:t.access_token,refreshToken:t.refresh_token??credentials.refreshToken,expiresAt:new Date(Date.now()+t.expires_in*1000).toISOString()};
}
type Attachment={name:string;mime:string;bytes:Uint8Array};
async function microsoftAttachments(token:string,messageId:string):Promise<Attachment[]>{
 const list=await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType,size,isInline`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20_000)});
 if(!list.ok)throw new Error(`graph_attachments_${list.status}`);
 const data=await list.json() as {value?:Array<{id?:string;name?:string;contentType?:string;size?:number;isInline?:boolean}>};
 const out:Attachment[]=[];
 for(const item of data.value??[]){
  if(!item.id||!item.name||item.isInline||(item.size??0)>100*1024*1024)continue;
  const raw=await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(item.id)}/$value`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30_000)});
  if(!raw.ok)continue;
  out.push({name:item.name,mime:item.contentType||raw.headers.get("content-type")||"application/octet-stream",bytes:new Uint8Array(await raw.arrayBuffer())});
 }
 return out;
}
type GmailPart={filename?:string;mimeType?:string;body?:{attachmentId?:string;data?:string;size?:number};parts?:GmailPart[]};
function gmailParts(part?:GmailPart):GmailPart[]{if(!part)return[];return [...(part.filename?.trim()&&part.body&&(part.body.attachmentId||part.body.data)?[part]:[]),...(part.parts??[]).flatMap(gmailParts)];}
async function gmailAttachments(token:string,messageId:string):Promise<Attachment[]>{
 const msg=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20_000)});
 if(!msg.ok)throw new Error(`gmail_message_${msg.status}`); const data=await msg.json() as {payload?:GmailPart};
 const out:Attachment[]=[];
 for(const part of gmailParts(data.payload)){
  if(!part.filename||(part.body?.size??0)>100*1024*1024)continue; let encoded=part.body?.data??"";
  if(part.body?.attachmentId){const r=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(part.body.attachmentId)}`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20_000)});if(!r.ok)continue;encoded=String((await r.json() as {data?:string}).data??"");}
  if(!encoded)continue; out.push({name:part.filename,mime:part.mimeType||"application/octet-stream",bytes:new Uint8Array(Buffer.from(encoded,"base64url"))});
 }
 return out;
}

export async function POST(request:NextRequest){
 const actor=await owner(request); if(!actor)return NextResponse.json({error:"MFA eller giltig bakgrundsauktorisering krävs."},{status:403});
 const db=createAdminClient(); const key=process.env.CREDENTIAL_ENCRYPTION_KEY; if(!key)return NextResponse.json({error:"Krypteringsnyckel saknas."},{status:503});
 const {data:jobs,error}=await db.from("vault_ingestion_jobs").select("*").eq("owner_id",actor.id).eq("state","pending").order("created_at").limit(5);
 if(error)return NextResponse.json({error:"Ingest-kön kunde inte läsas."},{status:500});
 let processed=0,saved=0,skipped=0,failed=0;
 for(const job of jobs??[]){
  const {data:claimed}=await db.from("vault_ingestion_jobs").update({state:"processing",attempts:Number(job.attempts??0)+1,updated_at:new Date().toISOString()}).eq("id",job.id).eq("owner_id",actor.id).eq("state","pending").select("id").maybeSingle(); if(!claimed)continue;
  try{
   const {data:conn}=await db.from("connections").select("id,provider,encrypted_credentials").eq("owner_id",actor.id).eq("id",job.connection_id).single();
   if(!conn?.encrypted_credentials)throw new Error("connection_missing");
   const original=decryptCredential<Credentials>(conn.encrypted_credentials,key); let creds:Credentials; let files:Attachment[];
   if(conn.provider===microsoftGraphConnector.id){creds=await refreshMicrosoft(original,request.nextUrl.origin);files=await microsoftAttachments(creds.accessToken,job.provider_message_id);}
   else if(conn.provider===googleGmailConnector.id){creds=await refreshGoogle(original,request.nextUrl.origin);files=await gmailAttachments(creds.accessToken,job.provider_message_id);}
   else throw new Error("unsupported_provider");
   if(creds.accessToken!==original.accessToken)await db.from("connections").update({encrypted_credentials:encryptCredential(creds,key),updated_at:new Date().toISOString()}).eq("id",conn.id).eq("owner_id",actor.id);
   for(const file of files){
    try{const result=await storeVaultFile({ownerId:actor.id,bytes:file.bytes,filename:file.name,mimeType:file.mime,sourceType:"email",sourceMessageId:job.source_message_id,sourceConversationId:job.source_conversation_id,sourcePersonId:job.source_person_id,messageText:job.message_text});if("skipped" in result)skipped++;else saved++;}catch{skipped++;}
   }
   await db.from("vault_ingestion_jobs").update({state:"done",last_error_code:null,updated_at:new Date().toISOString()}).eq("id",job.id).eq("owner_id",actor.id);processed++;
  }catch(e){failed++;await db.from("vault_ingestion_jobs").update({state:"failed",last_error_code:e instanceof Error?e.message.slice(0,120):"unknown",updated_at:new Date().toISOString()}).eq("id",job.id).eq("owner_id",actor.id);}
 }
 return NextResponse.json({processed,saved,skipped,failed,more:(jobs??[]).length===5});
}
