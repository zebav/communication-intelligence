import {z} from "zod";
import {travelFeasibility,type RouteService} from "./places-routing";
import type {TimeRange} from "./types";

export const travelPlanRequest=z.object({
 start:z.iso.datetime({offset:true}),end:z.iso.datetime({offset:true}),
 availableFrom:z.iso.datetime({offset:true}),availableUntil:z.iso.datetime({offset:true}),
 originPlaceId:z.string().trim().min(1).max(300),meetingPlaceId:z.string().trim().min(1).max(300),nextPlaceId:z.string().trim().min(1).max(300),
 mode:z.enum(["DRIVE","WALK","BICYCLE","TRANSIT"]),
}).strict().refine(p=>Date.parse(p.end)>Date.parse(p.start)&&Date.parse(p.availableFrom)<=Date.parse(p.start)&&Date.parse(p.availableUntil)>=Date.parse(p.end)&&Date.parse(p.availableUntil)-Date.parse(p.availableFrom)<=86400000,"Ogiltigt resefönster");
export type TravelPlanRequest=z.infer<typeof travelPlanRequest>;

/** Research is bound to exact places/times and both legs. It never authorizes a booking. */
export async function assessTravelPlan(raw:TravelPlanRequest,service:RouteService,context:{
 now:string;preparation:number;recovery:number;busy:TimeRange[];calendarReady:boolean;clock?:()=>string;
}) {
 const request=travelPlanRequest.parse(raw),now=Date.parse(context.now);
 if(!Number.isFinite(now)||Date.parse(request.availableFrom)<=now)throw new Error("Resefönstret måste ligga i framtiden.");
 if(!Number.isInteger(context.preparation)||!Number.isInteger(context.recovery)||context.preparation<0||context.recovery<0)throw new Error("Ogiltiga buffertar.");
 if(!context.calendarReady)return {status:"CALENDAR_REVIEW_REQUIRED" as const,canReserve:false};
 const outboundDeparture=new Date(Date.parse(request.end)+context.recovery*60000).toISOString();
 const [inbound,outbound]=await Promise.all([
  service.estimate({originPlaceId:request.originPlaceId,destinationPlaceId:request.meetingPlaceId,departureTime:request.availableFrom,mode:request.mode}),
  service.estimate({originPlaceId:request.meetingPlaceId,destinationPlaceId:request.nextPlaceId,departureTime:outboundDeparture,mode:request.mode}),
 ]);
 // Reject a provider/adaptor result for any other plan, even if its duration looks plausible.
 if(inbound.originPlaceId!==request.originPlaceId||inbound.destinationPlaceId!==request.meetingPlaceId||outbound.originPlaceId!==request.meetingPlaceId||outbound.destinationPlaceId!==request.nextPlaceId||inbound.mode!==request.mode||outbound.mode!==request.mode||Date.parse(inbound.departureTime)!==Date.parse(request.availableFrom)||Date.parse(outbound.departureTime)!==Date.parse(outboundDeparture))throw new Error("Reseunderlaget gäller inte den valda planen.");
 const check=travelFeasibility({...request,preparationMinutes:context.preparation,recoveryMinutes:context.recovery,now:context.clock?.()??new Date().toISOString(),inbound,outbound});
 const occupied={start:request.availableFrom,end:new Date(Date.parse(outboundDeparture)+outbound.minutes*60000).toISOString()};
 const conflict=context.busy.some(b=>{
  const a=Date.parse(b.start),z=Date.parse(b.end);if(!Number.isFinite(a)||!Number.isFinite(z)||z<=a)throw new Error("Kalenderunderlaget innehåller en ogiltig tid.");
  return a<Date.parse(occupied.end)&&z>Date.parse(occupied.start);
 });
 return {status:conflict?"CALENDAR_CONFLICT" as const:check.status,canReserve:false,
  request,inbound,outbound,occupied,preparation:context.preparation,recovery:context.recovery,
  expiresAt:new Date(Math.min(Date.parse(inbound.checkedAt),Date.parse(outbound.checkedAt))+300000).toISOString(),
  explanation:"Reseunderlag, inte en bokning. Ny kalender- och restidskontroll krävs vid ett framtida godkännande."};
}
