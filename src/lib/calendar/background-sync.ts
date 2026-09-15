import type { SupabaseClient } from "@supabase/supabase-js";
import { calendarToken } from "./service";
import { GoogleCalendarReader } from "./google-calendar";
import { OutlookCalendarReader } from "./outlook-calendar";

/** One source per invocation, claimed per account. It never writes provider events or holds. */
export async function runCalendarSyncTick(db:SupabaseClient) {
  const {data:jobs,error}=await db.rpc("claim_calendar_sync");
  if(error)throw new Error("Synkkön kunde inte läsas.");
  const job=jobs?.[0];
  if(!job)return {status:"idle" as const};
  const {data:source,error:read}=await db.from("calendar_sources").select("*").eq("owner_id",job.owner_id).eq("account_id",job.account_id).eq("enabled",true).order("synced_at",{ascending:true,nullsFirst:true}).order("id").limit(1).maybeSingle();
  if(read||!source)throw new Error("Kalenderkällan kunde inte läsas. Körningen återupptas när låset löper ut.");
  const now=Date.now(),range={start:new Date(now-7*86400000).toISOString(),end:new Date(now+60*86400000).toISOString()};
  const signal=AbortSignal.timeout(35000);
  const transport:typeof fetch=(url,options)=>fetch(url,{...options,signal:AbortSignal.any([signal,...(options?.signal?[options.signal]:[])])});
  let snapshot:unknown[]=[];let success=false;
  try {
    const {account,token}=await calendarToken(db,job.owner_id,job.account_id,signal);
    const events=account.provider==="google"?await new GoogleCalendarReader(token,transport).getEvents(source.external_id,range,source.timezone):await new OutlookCalendarReader(token,transport).getEvents(source.external_id,range);
    if(events.length>10000)throw new Error("Snapshot limit exceeded");
    snapshot=events.sort((a,b)=>a.id.localeCompare(b.id));success=true;
  } catch { /* Provider errors are deliberately not logged with tokens, names or payloads. */ }
  const {data:published,error:save}=await db.rpc("finish_calendar_sync",{p_account:job.account_id,p_lease:job.lease_token,p_source:source.id,p_expected_sync:source.synced_at,
    p_snapshot:snapshot,p_start:range.start,p_end:range.end,p_success:success});
  if(save)throw new Error("Synkresultatet kunde inte sparas.");
  return {status:!published?"superseded" as const:success?"synced" as const:"retry_scheduled" as const};
}
