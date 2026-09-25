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
 const {data,error}=await session.db.from("vault_assets").select("id,asset_kind,retention_status,title,filename,mime_type,size_bytes,sensitivity,document_type,summary,retention_reason,importance_score,reusable,source_type,source_person_id,source_message_id,created_at").eq("owner_id",session.user.id).eq("retention_status","saved").order("created_at",{ascending:false}).limit(500);
 return error?NextResponse.json({error:"Valvet kunde inte läsas."},{status:500}):NextResponse.json({assets:data??[]});
}
export async function POST(request:NextRequest){
 if(request.headers.get("origin")!==request.nextUrl.origin)return NextResponse.json({error:"Ogiltigt ursprung."},{status:403});
 const session=await auth(); if(!session)return NextResponse.json({error:"MFA krävs."},{status:403});
 const form=await request.formData(); const file=form.get("file");
 if(!(file instanceof File))return NextResponse.json({error:"Välj en fil."},{status:400});
 const sourceType=String(form.get("sourceType")??"manual");
 if(!["email","whatsapp","instagram","chatgpt_upload","google_photos","manual","other"].includes(sourceType))return NextResponse.json({error:"Ogiltig källa."},{status:400});
 try{
  const asset=await storeVaultFile({ownerId:session.user.id,bytes:new Uint8Array(await file.arrayBuffer()),filename:file.name,mimeType:file.type||"application/octet-stream",sourceType:sourceType as any,
   sourceMessageId:String(form.get("sourceMessageId")||"")||null,sourceConversationId:String(form.get("sourceConversationId")||"")||null,sourcePersonId:String(form.get("sourcePersonId")||"")||null,
   messageText:String(form.get("messageText")||""),forceKind:(String(form.get("forceKind")||"")||undefined) as any,forceSave:String(form.get("forceSave")||"")==="true"});
  return NextResponse.json({asset});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Filen kunde inte sparas."},{status:409});}
}
