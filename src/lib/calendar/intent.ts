import type { MeetingType } from "./types";
// Conservative first-pass discovery. It never confirms a booking or invents a date.
export function schedulingIntent(text:string) {
  const detected=/\b(meeting|meet|available|free on|coffee|lunch|dinner|padel|appointment|möte|träffas|ledig|fika|middag|boka|ses)\b/i.test(text);
  const type:MeetingType=/\b(dinner|middag)\b/i.test(text)?"DINNER":/\b(lunch)\b/i.test(text)?"LUNCH":/\b(coffee|fika)\b/i.test(text)?"COFFEE":/\bpadel\b/i.test(text)?"PADEL":"BUSINESS";
  const dates=[...new Set([...text.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map(m=>m[1]))].filter(value=>{
    const parsed=Date.parse(value+"T12:00:00Z");
    return Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===value;
  });
  const date=dates.length===1?dates[0]:undefined;
  const operation=/\b(cancel|cancelled|canceled|avboka|inställt|ställer in)\b/i.test(text)?"cancel":/\b(reschedule|flytta|omboka|ändra tiden)\b/i.test(text)?"change":"propose";
  return {detected:detected||operation!=="propose",type,date,operation,dates,needsDateConfirmation:!date,
    reason:operation==="cancel"?"Möjlig avbokning. Identifiera rätt bokning och granska innan något ändras.":operation==="change"?"Möjlig tidsändring. Befintlig bokning ska behållas tills ändringen godkänts.":dates.length>1?"Flera datum finns i konversationen. Välj vilket som fortfarande gäller.":date?"Ett uttryckligt datum finns i texten. Kontrollera att det fortfarande gäller.":"Välj datum själv: texten ger inte ett entydigt fullständigt datum."};
}
