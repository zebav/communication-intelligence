import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {storeVaultFile} from "@/lib/vault/vault-service";
import {z} from "zod";

async function auth(){
 const db=await createClient(); const {data:{user}}=await db.auth.getUser();
 if(!user)return null; const {data:aal}=await db.auth.mfa.getAuthenticatorAssuranceLevel();
 return aal?.currentLevel==="aal2"?{db,user}:null;
}

export async function GET(_request:NextRequest,{params}:{params:Promise<{personId:string}>}){
 const session=await auth(); if(!session)return new NextResponse(null,{status:403});
 const {personId}=await params;
 const sourceTypeParsed=z.enum(["manual","chatgpt_upload","google_photos","instagram","whatsapp","email","other"]).safeParse(String(form.get("sourceType")||"manual"));
 if(!sourceTypeParsed.success)return NextResponse.json({error:"Ogiltig bildkälla."},{status:400});
 const admin=createAdminClient();
 const {data:person,error}=await admin.from("people").select("avatar_asset_id").eq("owner_id",session.user.id).eq("id",personId).maybeSingle();
 if(error||!person?.avatar_asset_id)return new NextResponse(null,{status:404});
 const {data:asset}=await admin.from("vault_assets").select("storage_bucket,storage_path,mime_type").eq("owner_id",session.user.id).eq("id",person.avatar_asset_id).eq("retention_status","saved").maybeSingle();
 if(!asset)return new NextResponse(null,{status:404});
 const signed=await admin.storage.from(asset.storage_bucket).createSignedUrl(asset.storage_path,300);
 if(signed.error||!signed.data?.signedUrl)return new NextResponse(null,{status:404});
 return NextResponse.redirect(signed.data.signedUrl,307);
}

export async function POST(request:NextRequest,{params}:{params:Promise<{personId:string}>}){
 if(request.headers.get("origin")!==request.nextUrl.origin)return NextResponse.json({error:"Ogiltigt ursprung."},{status:403});
 const session=await auth(); if(!session)return NextResponse.json({error:"MFA krävs."},{status:403});
 const {personId}=await params;
 const form=await request.formData(); const file=form.get("file");
 if(!(file instanceof File)||!file.type.startsWith("image/"))return NextResponse.json({error:"Välj en bildfil."},{status:400});
 const admin=createAdminClient();
 const {data:person,error:personError}=await admin.from("people").select("id").eq("owner_id",session.user.id).eq("id",personId).maybeSingle();
 if(personError||!person)return NextResponse.json({error:"Kontakten kunde inte hittas."},{status:404});
 try{
  const asset=await storeVaultFile({ownerId:session.user.id,bytes:new Uint8Array(await file.arrayBuffer()),filename:file.name,mimeType:file.type,sourceType:sourceTypeParsed.data,sourcePersonId:personId,forceKind:"person_image",forceSave:true});
  if ("skipped" in asset) throw new Error("Kontaktbilden kunde inte sparas.");
  await admin.from("person_media").update({role:"reference"}).eq("owner_id",session.user.id).eq("person_id",personId).eq("role","avatar");
  const {error:mediaError}=await admin.from("person_media").upsert({owner_id:session.user.id,person_id:personId,asset_id:asset.id,role:"avatar",match_method:"manual",confidence:1,user_verified:true},{onConflict:"owner_id,person_id,asset_id"});
  if(mediaError)throw mediaError;
  const {error:updateError}=await admin.from("people").update({avatar_asset_id:asset.id,updated_at:new Date().toISOString()}).eq("owner_id",session.user.id).eq("id",personId);
  if(updateError)throw updateError;
  return NextResponse.json({success:true,assetId:asset.id});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Bilden kunde inte sparas."},{status:409});}
}
