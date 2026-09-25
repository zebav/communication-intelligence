import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { decideVaultRetention } from "./document-retention";

const allowed = new Set([
  "application/pdf","image/jpeg","image/png","image/webp","image/heic","image/heif","text/plain","text/csv","application/json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

function safeName(value:string){return value.replace(/[^a-zA-Z0-9._-]+/g,"_").slice(0,180)||"file";}

export async function storeVaultFile(input:{
  ownerId:string; bytes:Uint8Array; filename:string; mimeType:string; sourceType:"email"|"whatsapp"|"instagram"|"chatgpt_upload"|"google_photos"|"manual"|"other";
  sourceMessageId?:string|null; sourceConversationId?:string|null; sourcePersonId?:string|null; sourceAttachmentId?:string|null;
  messageText?:string; extractedText?:string; forceKind?:"document"|"person_image"|"image"|"other"; forceSave?:boolean;
}) {
  if (!allowed.has(input.mimeType)) throw new Error("Filtypen stöds inte i det säkra valvet.");
  if (!input.bytes.length || input.bytes.length > 100*1024*1024) throw new Error("Filen är tom eller för stor.");
  const sha256=createHash("sha256").update(input.bytes).digest("hex");
  const db=createAdminClient();
  const {data:existing,error:existingError}=await db.from("vault_assets").select("*").eq("owner_id",input.ownerId).eq("sha256",sha256).maybeSingle();
  if(existingError) throw existingError;
  if(existing) return existing;
  const decision=await decideVaultRetention({ownerId:input.ownerId,filename:input.filename,mimeType:input.mimeType,sourceType:input.sourceType,messageText:input.messageText,extractedText:input.extractedText});
  const assetKind=input.forceKind??decision.assetKind;
  const status=input.forceSave||decision.retain?"saved":"candidate";
  const id=randomUUID();
  const path=`${input.ownerId}/${id}/${safeName(input.filename)}`;
  const upload=await db.storage.from("secure-vault").upload(path,input.bytes,{contentType:input.mimeType,upsert:false});
  if(upload.error) throw upload.error;
  const {data,error}=await db.from("vault_assets").insert({
    id,owner_id:input.ownerId,asset_kind:assetKind,retention_status:status,title:decision.title||input.filename,
    filename:input.filename,mime_type:input.mimeType,size_bytes:input.bytes.length,storage_path:path,sha256,
    sensitivity:decision.sensitivity,document_type:decision.documentType||null,summary:decision.summary,
    retention_reason:decision.reason,importance_score:decision.importance,reusable:decision.reusable,
    source_type:input.sourceType,source_attachment_id:input.sourceAttachmentId??null,source_message_id:input.sourceMessageId??null,
    source_conversation_id:input.sourceConversationId??null,source_person_id:input.sourcePersonId??null,
    ai_decision:decision,metadata:{extracted_text_available:Boolean(input.extractedText)}
  }).select("*").single();
  if(error){await db.storage.from("secure-vault").remove([path]);throw error;}
  return data;
}

export async function signedVaultUrl(ownerId:string,assetId:string){
  const db=createAdminClient();
  const {data,error}=await db.from("vault_assets").select("storage_bucket,storage_path,filename,mime_type").eq("owner_id",ownerId).eq("id",assetId).eq("retention_status","saved").single();
  if(error||!data) throw new Error("Dokumentet kunde inte hittas.");
  const signed=await db.storage.from(data.storage_bucket).createSignedUrl(data.storage_path,300,{download:data.filename});
  if(signed.error||!signed.data?.signedUrl) throw new Error("Dokumentlänken kunde inte skapas.");
  return {...data,url:signed.data.signedUrl};
}
