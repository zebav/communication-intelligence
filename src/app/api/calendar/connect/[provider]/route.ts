import { NextResponse,type NextRequest } from "next/server";
import { startCalendarConsent } from "@/lib/calendar/oauth";
export async function GET(request:NextRequest,{params}:{params:Promise<{provider:string}>}) {
  const {provider}=await params;
  if(provider!=="google"&&provider!=="microsoft") return NextResponse.json({error:"Okänd kalenderleverantör"},{status:400});
  try{return await startCalendarConsent(request,provider);}catch{return NextResponse.redirect(new URL("/?view=calendar&calendar=configuration",request.url));}
}
