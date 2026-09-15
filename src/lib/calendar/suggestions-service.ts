import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultPlanningPreferences, planningPreferencesSchema, planningWindow } from "./planning-preferences";
import { suggestSlots } from "./scheduling";
import type { CalendarEvent, CalendarHold } from "./types";

export async function calendarSuggestions(db:SupabaseClient,owner:string,input:{date:string;duration:number;preparation:number;recovery:number;physical:boolean}) {
  const [settings,sources,holds,rules] = await Promise.all([
    db.from("calendar_workspace").select("timezone").eq("owner_id",owner).single(),
    db.from("calendar_sources").select("*").eq("owner_id",owner).eq("enabled",true),
    db.from("calendar_holds").select("*").eq("owner_id",owner).gte("ends_at",new Date().toISOString()).limit(1000),
    db.from("calendar_planning_preferences").select("rules").eq("owner_id",owner).maybeSingle(),
  ]);
  if(settings.error||sources.error||holds.error||rules.error) throw new Error("Kalenderunderlaget eller planeringsreglerna kunde inte läsas.");
  if(holds.data.length>=1000) throw new Error("För många reservationer för en säker bedömning.");
  const p = rules.data ? planningPreferencesSchema.parse(rules.data.rules) : defaultPlanningPreferences;
  const timezone = settings.data.timezone;
  const windows = planningWindow(input.date,timezone,p);
  const now = new Date().toISOString(), master = sources.data.find(s=>s.is_master);
  const syncFresh = Boolean(master) && sources.data.every(s=>s.synced_at&&Date.parse(s.synced_at)>Date.now()-300000&&!s.sync_error
    && windows.every(w=>Date.parse(s.window_start)<=Date.parse(w.start)&&Date.parse(s.window_end)>=Date.parse(w.end)));
  const slots = suggestSlots({windows,events:(master?.snapshot??[]) as CalendarEvent[],
    holds:holds.data.filter(h=>h.status!=="released").map(h=>({id:h.id,start:new Date(Date.parse(h.starts_at)-h.preparation_minutes*60000).toISOString(),
      end:new Date(Date.parse(h.ends_at)+h.recovery_minutes*60000).toISOString(),expiresAt:h.status==="active"?h.expires_at:"9999-01-01T00:00:00Z",status:"active",conversationId:h.conversation_id??""})) as CalendarHold[],
    preferences:{durationMinutes:input.duration,preparationMinutes:Math.max(input.preparation,p.preparationMinutes),recoveryMinutes:Math.max(input.recovery,p.recoveryMinutes),stepMinutes:30,timezone},
    physical:input.physical,reconciled:sources.data.filter(s=>!s.is_master).every(s=>JSON.stringify(s.snapshot)===JSON.stringify(s.reviewed_snapshot)),syncFresh,now,
    minimumNoticeMinutes:p.minimumNoticeMinutes,maximumMeetingMinutesPerDay:p.maximumMeetingMinutesPerDay});
  return {slots,timezone,preparation:Math.max(input.preparation,p.preparationMinutes),recovery:Math.max(input.recovery,p.recoveryMinutes)};
}
