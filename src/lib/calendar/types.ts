export type MeetingType = "BUSINESS" | "INTERNAL" | "CUSTOMER" | "COFFEE" | "LUNCH" | "DINNER" | "DATE" | "PADEL" | "SOCIAL" | "TRAVEL" | "MEDICAL" | "PERSONAL" | "OTHER";
export type TimeRange = { start: string; end: string };
export type CalendarEvent = {
  id: string; calendarId: string; title: string; timezone: string;
  start: string; end: string; allDay: boolean; location?: string;
  status: "confirmed" | "tentative" | "cancelled"; blocksAvailability: boolean;
  recurrenceId?: string; etag?: string;
  description?:string; attendees?:{email?:string;responseStatus?:string}[];
};
export type CalendarHold = TimeRange & { id: string; expiresAt: string; status: "active" | "released" | "confirmed"; conversationId: string };
export type CalendarInfo = { id: string; name: string; timezone: string; access: "reader" | "writer" | "owner" };
export type CalendarConnector = {
  provider: string;
  getCalendars(): Promise<CalendarInfo[]>;
  getEvents(calendarId: string, range: TimeRange): Promise<CalendarEvent[]>;
  getFreeBusy(calendarIds: string[], range: TimeRange): Promise<TimeRange[]>;
  syncChanges(calendarId: string, cursor?: string): Promise<{ events: CalendarEvent[]; nextCursor: string }>;
  createEvent(calendarId: string, event: CalendarEvent, idempotencyKey: string): Promise<CalendarEvent>;
  updateEvent(calendarId: string, event: CalendarEvent, expectedEtag: string): Promise<CalendarEvent>;
};
export type SchedulingPreferences = {
  durationMinutes: number; preparationMinutes: number; recoveryMinutes: number;
  stepMinutes: number; timezone: string;
};
export const meetingDefaults: Record<MeetingType, Pick<SchedulingPreferences, "durationMinutes" | "preparationMinutes" | "recoveryMinutes">> = {
  BUSINESS: { durationMinutes: 45, preparationMinutes: 10, recoveryMinutes: 10 },
  INTERNAL: { durationMinutes: 45, preparationMinutes: 10, recoveryMinutes: 10 },
  CUSTOMER: { durationMinutes: 45, preparationMinutes: 15, recoveryMinutes: 10 },
  COFFEE: { durationMinutes: 60, preparationMinutes: 20, recoveryMinutes: 20 },
  LUNCH: { durationMinutes: 90, preparationMinutes: 20, recoveryMinutes: 20 },
  DINNER: { durationMinutes: 120, preparationMinutes: 20, recoveryMinutes: 20 },
  DATE: { durationMinutes: 150, preparationMinutes: 30, recoveryMinutes: 30 },
  PADEL: { durationMinutes: 90, preparationMinutes: 20, recoveryMinutes: 20 },
  SOCIAL: { durationMinutes: 90, preparationMinutes: 20, recoveryMinutes: 20 },
  TRAVEL: { durationMinutes: 120, preparationMinutes: 90, recoveryMinutes: 30 },
  MEDICAL: { durationMinutes: 60, preparationMinutes: 20, recoveryMinutes: 20 },
  PERSONAL: { durationMinutes: 60, preparationMinutes: 20, recoveryMinutes: 20 },
  OTHER: { durationMinutes: 60, preparationMinutes: 20, recoveryMinutes: 20 },
};
