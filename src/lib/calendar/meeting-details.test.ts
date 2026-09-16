import {describe,it,expect} from "vitest";
import {meetingDetailsSchema,meetingPayload,recipientsSchema,sameRecipients,travelReservation} from "./meeting-details";
const travel={start:"2098-01-01T10:00:00Z",end:"2098-01-01T11:00:00Z",availableFrom:"2098-01-01T09:00:00Z",availableUntil:"2098-01-01T12:00:00Z",originPlaceId:"private-home",meetingPlaceId:"venue",nextPlaceId:"private-next",mode:"DRIVE" as const};
describe("meeting details and invitation privacy",()=>{
 it("normalizes and deduplicates recipients",()=>expect(recipientsSchema.parse([" A@example.com ","a@example.com"])).toEqual(["a@example.com"]));
 it("rejects invalid addresses",()=>expect(()=>recipientsSchema.parse(["not an email"])).toThrow());
 it("reserves both complete travel windows",()=>expect(travelReservation(meetingDetailsSchema.parse({travel,locationLabel:"Venue"}),travel.start,travel.end)).toEqual({preparation:60,recovery:60}));
 it("rejects travel for a different appointment",()=>expect(()=>travelReservation(meetingDetailsSchema.parse({travel,locationLabel:"Venue"}),"2098-01-01T10:30:00Z",travel.end)).toThrow("annan"));
 it("rejects buffers beyond the database maximum",()=>expect(()=>travelReservation(meetingDetailsSchema.parse({travel:{...travel,availableFrom:"2098-01-01T06:00:00Z"},locationLabel:"Venue"}),travel.start,travel.end)).toThrow("tre timmar"));
 it("does not disclose private origin or next destination to guests",()=>{
  const payload=meetingPayload(meetingDetailsSchema.parse({travel,locationLabel:"Venue",attendees:["guest@example.com"],description:"Agenda"}));
  expect(payload).toEqual({description:"Agenda",location:"Venue",attendees:[{email:"guest@example.com"}]});expect(JSON.stringify(payload)).not.toContain("private");
 });
 it("compares recipients independently of order or casing",()=>expect(sameRecipients([{email:"A@example.com"}], ["a@example.com"])).toBe(true));
});
