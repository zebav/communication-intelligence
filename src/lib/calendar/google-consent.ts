import { googleCalendarScopes } from "./google-calendar";

export type GoogleConsentPurpose = "gmail" | "calendar";
// Missing scopes never mean consent was granted. Token response is authoritative.
export function grantedGoogleScopes(scope: unknown): string[] {
  if (typeof scope !== "string") return [];
  return [...new Set(scope.trim().split(/\s+/).filter(Boolean))].sort();
}
export function googleCalendarCapabilities(scope: unknown) {
  const granted = new Set(grantedGoogleScopes(scope));
  const full = granted.has("https://www.googleapis.com/auth/calendar");
  const readonly = full || granted.has("https://www.googleapis.com/auth/calendar.readonly");
  return {
    listCalendars: readonly || granted.has(googleCalendarScopes[0]),
    readEvents: readonly || granted.has(googleCalendarScopes[1]) || granted.has("https://www.googleapis.com/auth/calendar.events"),
    readFreeBusy: readonly || granted.has(googleCalendarScopes[2]) || granted.has("https://www.googleapis.com/auth/calendar.freebusy"),
    manageAppCreatedCalendar: full || granted.has(googleCalendarScopes[3]),
  };
}
export function validateCalendarGrant(scope: unknown) {
  const capabilities = googleCalendarCapabilities(scope);
  return { capabilities, complete: Object.values(capabilities).every(Boolean), scopes: grantedGoogleScopes(scope) };
}
