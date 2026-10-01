import {NextRequest,NextResponse} from "next/server";
import {z} from "zod";
import {createClient} from "@/lib/supabase/server";
import {signedVaultUrl,storeVaultFile} from "@/lib/vault/vault-service";

async function auth(){
 const db=await createClient(); const {data:{user}}=await db.auth.getUser();
 if(!user)return null; const {data:aal}=await db.auth.mfa.getAuthenticatorAssuranceLevel();
 return aal?.currentLevel==="aal2"?{db,user}:null;
}
export async function GET(request:NextRequest){
 const session=await auth(); if(!session)return NextResponse.json({error:"MFA krävs."},{status:403});
  const assetId=request.nextUrl.searchParams.get("assetId");
 if(assetId){
  const parsed=z.string().uuid().safeParse(assetId); if(!parsed.success)return NextResponse.json({error:"Ogiltigt dokument."},{status:400});
  try{return NextResponse.json(await signedVaultUrl(session.user.id,parsed.data));}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Dokumentet kunde inte öppnas."},{status:404});}
  }
 const messageId=request.nextUrl.searchParams.get("messageId");
 if(messageId){
  const parsed=z.string().uuid().safeParse(messageId); if(!parsed.success)return NextResponse.json({error:"Ogiltigt meddelande."},{status:400});
  const {data,error}=await session.db.from("vault_assets").select("id,asset_kind,title,filename,mime_type,summary,source_type,ai_decision,created_at").eq("owner_id",session.user.id).eq("source_message_id",parsed.data).eq("retention_status","saved").order("created_at",{ascending:true});
  if(error)return NextResponse.json({error:"Bilagorna kunde inte läsas."},{status:500});
  const assets=(data??[]).map(asset=>{const decision=asset.ai_decision&&typeof asset.ai_decision==="object"&&!Array.isArray(asset.ai_decision)?asset.ai_decision as Record<string,unknown>:{};const audio=asset.mime_type.startsWith("audio/");return {...asset,previewUrl:(asset.mime_type.startsWith("image/")||audio)?`/api/vault/assets/${asset.id}/preview`:undefined,transcript:audio?(typeof decision.transcript==="string"?decision.transcript:asset.summary||null):null};});
  return NextResponse.json({assets},{headers:{"Cache-Control":"no-store"}});
 }
 const {data,error}=await session.db.from("vault_assets").select("id,asset_kind,retention_status,title,filename,mime_type,size_bytes,sensitivity,document_type,summary,retention_reason,importance_score,reusable,source_type,source_person_id,source_message_id,ai_decision,external_origin:metadata->>external_origin,created_at").eq("owner_id",session.user.id).eq("retention_status","saved").order("created_at",{ascending:false}).limit(100);
 if(error)return NextResponse.json({error:"Valvet kunde inte läsas."},{status:500});
 const assets=data??[];
 const personIds=[...new Set(assets.flatMap(asset=>asset.source_person_id?[asset.source_person_id]:[]))];
 const messageIds=[...new Set(assets.flatMap(asset=>asset.source_message_id?[asset.source_message_id]:[]))];
 const [{data:people},{data:messages}]=await Promise.all([
  personIds.length?session.db.from("people").select("id,display_name,organization").eq("owner_id",session.user.id).in("id",personIds):Promise.resolve({data:[] as Array<{id:string;display_name:string;organization:string|null}>}),
  messageIds.length?session.db.from("messages").select("id,body_text").eq("owner_id",session.user.id).in("id",messageIds):Promise.resolve({data:[] as Array<{id:string;body_text:string|null}>}),
 ]);
 const peopleById=new Map((people??[]).map(person=>[person.id,person]));
 const messagesById=new Map((messages??[]).map(message=>[message.id,message]));
 const enriched=await Promise.all(assets.map(async asset=>{
  const person=asset.source_person_id?peopleById.get(asset.source_person_id):undefined;
  const message=asset.source_message_id?messagesById.get(asset.source_message_id):undefined;
  const audio=asset.mime_type.startsWith("audio/");
  const decision=asset.ai_decision&&typeof asset.ai_decision==="object"&&!Array.isArray(asset.ai_decision)?asset.ai_decision as Record<string,unknown>:{};
  const previewUrl=(asset.mime_type.startsWith("image/")||audio)?`/api/vault/assets/${asset.id}/preview`:undefined;
  return {...asset,previewUrl,sourcePerson:person?{id:person.id,name:person.display_name,organization:person.organization}:null,transcript:audio?(typeof decision.transcript==="string"?decision.transcript:message?.body_text||asset.summary||null):null};
 }));
 return NextResponse.json({assets:enriched},{headers:{"Cache-Control":"no-store"}});
}
export async function POST(request:NextRequest){
 if(request.headers.get("origin")!==request.nextUrl.origin)return NextResponse.json({error:"Ogiltigt ursprung."},{status:403});
 const session=await auth(); if(!session)return NextResponse.json({error:"MFA krävs."},{status:403});
 const form=await request.formData(); const file=form.get("file");
 if(!(file instanceof File))return NextResponse.json({error:"Välj en fil."},{status:400});
 const sourceTypeParsed=z.enum(["email","whatsapp","instagram","chatgpt_upload","google_photos","manual","other"]).safeParse(String(form.get("sourceType")??"manual"));
 if(!sourceTypeParsed.success)return NextResponse.json({error:"Ogiltig källa."},{status:400});
 const kindParsed=z.enum(["document","person_image","image","other"]).optional().safeParse(String(form.get("forceKind")||"")||undefined);
 if(!kindParsed.success)return NextResponse.json({error:"Ogiltig filtyp."},{status:400});
 const originParsed=z.enum(["google_drive","onedrive","google_photos","device"]).optional().safeParse(String(form.get("externalOrigin")||"")||undefined);
 if(!originParsed.success)return NextResponse.json({error:"Ogiltigt filursprung."},{status:400});
 try{
  const asset=await storeVaultFile({ownerId:session.user.id,bytes:new Uint8Array(await file.arrayBuffer()),filename:file.name,mimeType:file.type||"application/octet-stream",sourceType:sourceTypeParsed.data,
   sourceMessageId:String(form.get("sourceMessageId")||"")||null,sourceConversationId:String(form.get("sourceConversationId")||"")||null,sourcePersonId:String(form.get("sourcePersonId")||"")||null,
   messageText:String(form.get("messageText")||""),forceKind:kindParsed.data,forceSave:String(form.get("forceSave")||"")==="true",provenance:{externalOrigin:originParsed.data}});
  return NextResponse.json({asset});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Filen kunde inte sparas."},{status:409});}
}
