import {z} from "zod";
import {travelPlanRequest} from "./travel-plan";

export const recipientsSchema=z.array(z.string().trim().email().max(254).transform(v=>v.toLowerCase())).max(30)
 .transform(values=>[...new Set(values)].sort());
export const meetingDetailsSchema=z.object({
 description:z.string().trim().max(8000).default(""),
 attendees:recipientsSchema.default([]),
 personIds:z.array(z.string().uuid()).max(30).transform(v=>[...new Set(v)]).default([]),
 googlePlaceId:z.string().trim().min(1).max(300).nullable().default(null),
 locationLabel:z.string().trim().max(500).default(""),
 travel:travelPlanRequest.nullable().default(null),
}).strict().refine(d=>!d.travel||d.locationLabel.length>0,"Ange platsen som mottagarna ska se.")
 .refine(d=>!d.travel||!d.googlePlaceId||d.googlePlaceId===d.travel.meetingPlaceId,"Resan måste gälla den valda mötesplatsen.");
export type MeetingDetails=z.infer<typeof meetingDetailsSchema>;
export function travelReservation(details:MeetingDetails,start:string,end:string) {
 if(!details.travel)return null;
 const p=details.travel;
 if(Date.parse(p.start)!==Date.parse(start)||Date.parse(p.end)!==Date.parse(end))throw new Error("Reseplanen gäller en annan mötestid.");
 const preparation=(Date.parse(start)-Date.parse(p.availableFrom))/60000,recovery=(Date.parse(p.availableUntil)-Date.parse(end))/60000;
 if(!Number.isInteger(preparation)||!Number.isInteger(recovery)||preparation<0||recovery<0||preparation>180||recovery>180)throw new Error("Reservera högst tre timmar före och efter mötet för resa och buffertar.");
 return {preparation,recovery};
}
export function meetingPayload(details:MeetingDetails) {
 return {description:details.description,location:details.locationLabel,...(details.attendees.length?{attendees:details.attendees.map(email=>({email}))}:{})};
}
export function sameRecipients(raw:unknown,expected:string[]) {
 const parsed=z.array(z.object({email:z.string().email()})).safeParse(raw??[]);
 return parsed.success&&JSON.stringify([...new Set(parsed.data.map(a=>a.email.toLowerCase()))].sort())===JSON.stringify([...expected].sort());
}
