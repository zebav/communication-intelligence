import {z} from "zod";
export const eventContextSchema=z.object({
 sourceId:z.string().uuid(),eventId:z.string().min(1).max(2000),revision:z.number().int().min(0),
 personIds:z.array(z.string().uuid()).max(30).refine(ids=>new Set(ids).size===ids.length),
 conversationId:z.string().uuid().nullable(),locationKind:z.enum(["unknown","physical","digital"]),
 googlePlaceId:z.string().trim().min(1).max(300).nullable(),
 userPlaceLabel:z.string().trim().max(500),
 meetingUrl:z.string().trim().max(2000).refine(value=>{
  if(!value)return true;try{const url=new URL(value);return url.protocol==="https:"&&!url.username&&!url.password;}catch{return false;}
 }),
}).strict().refine(v=>(v.locationKind==="physical"||v.googlePlaceId===null)&&(v.locationKind==="digital"||v.meetingUrl===""));
export type EventContextInput=z.infer<typeof eventContextSchema>;
