import {describe,it,expect,vi} from "vitest";
import {defaultPlanningPreferences,occupiedMinutes,planningPreferencesSchema,planningWindow} from "./planning-preferences";
import {GooglePlacesRoutes,travelFeasibility,type RouteEstimate} from "./places-routing";
import {reviewCommitments} from "./reconciliation";
import {suggestSlots} from "./scheduling";
import type {CalendarEvent} from "./types";

const event:CalendarEvent={id:"e",calendarId:"external",title:"Möte",timezone:"Europe/Stockholm",start:"2026-10-01T08:00:00Z",end:"2026-10-01T09:00:00Z",allDay:false,status:"confirmed",blocksAvailability:true};
describe("planning rules",()=>{
 it("validates complete dates and excluded weekdays",()=>{
  expect(()=>planningWindow("2026-02-30","UTC",defaultPlanningPreferences)).toThrow();
  expect(planningWindow("2026-10-04","UTC",{...defaultPlanningPreferences,weekdays:[1,2,3,4,5]})).toEqual([]);
  expect(planningPreferencesSchema.safeParse({...defaultPlanningPreferences,dayStart:"18:00",dayEnd:"09:00"}).success).toBe(false);
 });
 it("uses the local day's DST offset",()=>expect(planningWindow("2026-10-26","Europe/Stockholm",defaultPlanningPreferences)[0].start).toBe("2026-10-26T07:00:00.000Z"));
 it("counts overlapping events only once",()=>expect(occupiedMinutes([event,event,{start:"2026-10-01T08:30:00Z",end:"2026-10-01T09:30:00Z"}],{start:"2026-10-01T08:00:00Z",end:"2026-10-01T10:00:00Z"})).toBe(90));
 it("applies notice and maximum daily time",()=>{
  const input={windows:[{start:"2026-10-01T08:00:00Z",end:"2026-10-01T13:00:00Z"}],events:[event],holds:[],physical:false,reconciled:true,syncFresh:true,now:"2026-10-01T08:00:00Z",preferences:{durationMinutes:60,preparationMinutes:0,recoveryMinutes:0,stepMinutes:30,timezone:"UTC"}};
  expect(suggestSlots({...input,minimumNoticeMinutes:180})[0].start).toBe("2026-10-01T11:00:00.000Z");
  expect(suggestSlots({...input,maximumMeetingMinutesPerDay:90})).toEqual([]);
 });
});
describe("commitment reconciliation",()=>{
 it("does not merge by title alone",()=>expect(reviewCommitments([event],[{...event,id:"m",start:"2026-10-01T08:30:00Z"}])[0].status).toBe("conflict"));
 it("suggests exact matches, missing and free events separately",()=>{
  expect(reviewCommitments([event],[{...event,id:"m"}])[0].status).toBe("matched");
  expect(reviewCommitments([event],[])[0].status).toBe("missing");
  expect(reviewCommitments([{...event,blocksAvailability:false}],[])[0].status).toBe("informational");
  expect(reviewCommitments([{...event,status:"cancelled"}],[])).toEqual([]);
 });
});
describe("Google Maps adapter",()=>{
 it("uses field masks, fixed hosts and returns only required place data",async()=>{
  const transport=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({places:[{id:"p",displayName:{text:"Plats"},formattedAddress:"Adress",googleMapsUri:"https://maps.google.com/?q=p"}]})));
  expect(await new GooglePlacesRoutes("synthetic",transport).search("Stockholm")).toEqual([{id:"p",name:"Plats",address:"Adress",mapsUrl:"https://maps.google.com/?q=p"}]);
  expect(transport.mock.calls[0][0]).toBe("https://places.googleapis.com/v1/places:searchText");
  expect(transport.mock.calls[0][1]?.headers).toHaveProperty("X-Goog-FieldMask");
 });
 it("rounds travel up and requests future traffic for driving",async()=>{
  const transport=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({routes:[{duration:"61s",distanceMeters:1200}]})));
  const input={originPlaceId:"a",destinationPlaceId:"b",departureTime:new Date(Date.now()+86400000).toISOString(),mode:"DRIVE" as const};
  expect((await new GooglePlacesRoutes("test",transport).estimate(input)).minutes).toBe(2);
  expect(JSON.parse(transport.mock.calls[0][1]?.body as string)).toMatchObject({routingPreference:"TRAFFIC_AWARE",departureTime:input.departureTime});
 });
 it("never converts unavailable route into zero",async()=>{
  const transport=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({routes:[]})));
  await expect(new GooglePlacesRoutes("test",transport).estimate({originPlaceId:"a",destinationPlaceId:"b",departureTime:new Date(Date.now()+86400000).toISOString(),mode:"WALK"})).rejects.toThrow();
 });
});
describe("travel feasibility",()=>{
 const now="2026-10-01T07:00:00Z";
 const inbound:RouteEstimate={status:"ESTIMATED",minutes:30,distanceMeters:1000,checkedAt:now,departureTime:"2026-10-01T08:00:00Z",originPlaceId:"home",destinationPlaceId:"meeting",mode:"DRIVE"};
 const outbound:RouteEstimate={...inbound,originPlaceId:"meeting",destinationPlaceId:"next",departureTime:"2026-10-01T10:15:00Z"};
 const input={start:"2026-10-01T09:00:00Z",end:"2026-10-01T10:00:00Z",availableFrom:"2026-10-01T08:00:00Z",availableUntil:"2026-10-01T11:00:00Z",preparationMinutes:15,recoveryMinutes:15,now,inbound,outbound};
 it("requires both legs and fresh evidence",()=>{
  expect(travelFeasibility({...input,outbound:undefined}).status).toBe("TRAVEL_TIME_UNKNOWN");
  expect(travelFeasibility({...input,now:"2026-10-01T07:06:00Z"}).bookable).toBe(false);
  expect(travelFeasibility({...input,outbound:{...outbound,originPlaceId:"wrong"}}).bookable).toBe(false);
 });
 it("separates travel, preparation and recovery",()=>{
  expect(travelFeasibility(input).bookable).toBe(true);
  expect(travelFeasibility({...input,inbound:{...inbound,minutes:60}}).status).toBe("NOT_FEASIBLE");
  expect(travelFeasibility({...input,outbound:{...outbound,minutes:60}}).status).toBe("NOT_FEASIBLE");
 });
});
