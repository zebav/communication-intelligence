import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createGoogleOAuthAttempt, googleAuthorizationUrl, googleConfig } from "../connectors/google-oauth";
import { microsoftConfig } from "../connectors/microsoft-oauth";
import { encryptCredential,decryptCredential } from "../connectors/credential-crypto";
import { validateCalendarGrant, grantedGoogleScopes } from "./google-consent";
import { calendarSession } from "./auth";
import { calendarStartDestination } from "./callback";
export type CalendarProvider="google"|"microsoft";
export const microsoftCalendarConsentScopes=["openid","profile","offline_access","User.Read","Calendars.Read"];
function calendarConfig(origin:string,provider:CalendarProvider) {
  const config=provider==="google"?googleConfig(origin):microsoftConfig(origin);
  const override=provider==="google"?process.env.GOOGLE_CALENDAR_REDIRECT_URI:process.env.MICROSOFT_CALENDAR_REDIRECT_URI;
  return {...config,redirectUri:override?.trim()||config.redirectUri};
}
export async function startCalendarConsent(request:NextRequest,provider:CalendarProvider) {
  const {owner}=await calendarSession();
  const config=calendarConfig(request.nextUrl.origin,provider);
  const destination=calendarStartDestination(config.redirectUri,request.url,request.headers.get("host"));
  if(destination) return NextResponse.redirect(destination);
  const attempt=createGoogleOAuthAttempt(), jar=await cookies();
  const path=`/api/connectors/${provider}`;
  const options={httpOnly:true,secure:true,sameSite:"lax" as const,maxAge:600,path};
  jar.set(`${provider}_oauth_state`,attempt.state,options);
  jar.set(`${provider}_oauth_verifier`,attempt.verifier,options);
  jar.set(`${provider}_oauth_purpose`,"calendar",options);
  jar.set(`${provider}_oauth_owner`,owner,options);
  if(provider==="google") return NextResponse.redirect(googleAuthorizationUrl(config,attempt.state,attempt.challenge,"calendar"));
  const ms=microsoftConfig(request.nextUrl.origin);
  const url=new URL(`https://login.microsoftonline.com/${ms.tenant}/oauth2/v2.0/authorize`);
  url.search=new URLSearchParams({client_id:ms.clientId,redirect_uri:config.redirectUri,response_type:"code",response_mode:"query",scope:microsoftCalendarConsentScopes.join(" "),state:attempt.state,code_challenge:attempt.challenge,code_challenge_method:"S256",prompt:"select_account"}).toString();
  return NextResponse.redirect(url);
}
export async function finishCalendarConsent(request:NextRequest,provider:CalendarProvider) {
  const redirect=(result:string)=>NextResponse.redirect(new URL(`/?view=calendar&calendar=${result}`,request.url));
  const jar=await cookies(), expected=jar.get(`${provider}_oauth_state`)?.value, verifier=jar.get(`${provider}_oauth_verifier`)?.value;
  const expectedOwner=jar.get(`${provider}_oauth_owner`)?.value;
  for(const suffix of ["state","verifier","purpose","owner"]) jar.set(`${provider}_oauth_${suffix}`,"",{path:`/api/connectors/${provider}`,maxAge:0});
  const state=request.nextUrl.searchParams.get("state"),code=request.nextUrl.searchParams.get("code");
  if(!state||!expected||!verifier||!code||Buffer.byteLength(state)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(state),Buffer.from(expected))) return redirect("denied");
  try {
    const {db,owner}=await calendarSession();
    if(owner!==expectedOwner) return redirect("denied");
    const config=calendarConfig(request.nextUrl.origin,provider);
    const endpoint=provider==="google"?"https://oauth2.googleapis.com/token":`https://login.microsoftonline.com/${microsoftConfig(request.nextUrl.origin).tenant}/oauth2/v2.0/token`;
    const response=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,grant_type:"authorization_code",code,code_verifier:verifier,redirect_uri:config.redirectUri,...(provider==="microsoft"?{scope:microsoftCalendarConsentScopes.join(" ")}:{})}),signal:AbortSignal.timeout(15000)});
    if(!response.ok) return redirect("failed");
    const token=await response.json();
    const scopes=grantedGoogleScopes(token.scope);
    const complete=provider==="google"?validateCalendarGrant(token.scope).complete:scopes.some(s=>s==="Calendars.Read"||s==="https://graph.microsoft.com/Calendars.Read");
    if(!complete||!token.access_token||!Number.isFinite(token.expires_in)) return redirect("missing_permissions");
    const who=await fetch(provider==="google"?"https://openidconnect.googleapis.com/v1/userinfo":"https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName",{headers:{authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(15000)});
    if(!who.ok) return redirect("failed");
    const profile=await who.json(), identity=provider==="google"?profile.sub:profile.id;
    const address=provider==="google"?profile.email:(profile.mail||profile.userPrincipalName);
    if(typeof identity!=="string"||typeof address!=="string") return redirect("failed");
    const key=process.env.CREDENTIAL_ENCRYPTION_KEY;
    if(!key) return redirect("configuration");
    const {data:existing,error:readError}=await db.from("calendar_accounts").select("id,encrypted_credentials").eq("owner_id",owner).eq("provider",provider).eq("external_id",identity).maybeSingle();
    if(readError) return redirect("database_setup");
    const refreshToken=token.refresh_token || (existing?decryptCredential<{refreshToken:string}>(existing.encrypted_credentials,key).refreshToken:undefined);
    if(!refreshToken) return redirect("missing_refresh");
    const {error}=await db.from("calendar_accounts").upsert({owner_id:owner,provider,external_id:identity,address,scopes,encrypted_credentials:encryptCredential({accessToken:token.access_token,refreshToken,expiresAt:new Date(Date.now()+token.expires_in*1000).toISOString()},key)},{onConflict:"owner_id,provider,external_id"});
    return redirect(error?"failed":"connected");
  } catch {return redirect("failed");}
}
