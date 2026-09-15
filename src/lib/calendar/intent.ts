import type { MeetingType } from "./types";
// Conservative first-pass discovery. It never confirms a booking or invents a date.
export function schedulingIntent(text:string) {
  const detected=/\b(meeting|meet|available|free on|coffee|lunch|dinner|padel|appointment|möte|träffas|ledig|fika|middag|boka|ses)\b/i.test(text);
  const type:MeetingType=/\b(dinner|middag)\b/i.test(text)?"DINNER":/\b(lunch)\b/i.test(text)?"LUNCH":/\b(coffee|fika)\b/i.test(text)?"COFFEE":/\bpadel\b/i.test(text)?"PADEL":"BUSINESS";
  const dateMatch=text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const parsed=dateMatch?Date.parse(dateMatch[1]+"T12:00:00Z"):NaN;
  const date=dateMatch&&Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===dateMatch[1]?dateMatch[1]:undefined;
  return {detected,type,date,needsDateConfirmation:!date,reason:date?"Ett uttryckligt datum finns i texten. Kontrollera att det fortfarande gäller.":"Välj datum själv: texten ger inte ett entydigt fullständigt datum."};
}
