import {describe,expect,it,vi} from "vitest";
import {assessTravelPlan} from "./travel-plan";
import type {RouteRequest} from "./places-routing";
const now="2026-09-16T08:00:00Z",request={start:"2026-09-16T10:00:00Z",end:"2026-09-16T11:00:00Z",availableFrom:"2026-09-16T09:00:00Z",availableUntil:"2026-09-16T12:00:00Z",originPlaceId:"home",meetingPlaceId:"meeting",nextPlaceId:"office",mode:"DRIVE" as const};
const context={now,clock:()=>now,preparation:10,recovery:10,busy:[],calendarReady:true};
const estimate=async(r:RouteRequest)=>({...r,status:"ESTIMATED" as const,minutes:20,distanceMeters:1000,checkedAt:now});
describe("two-leg travel plan",()=>{
 it("checks both legs, including recovery before onward travel",async()=>{
  const service={estimate:vi.fn(estimate)},result=await assessTravelPlan(request,service,context);
  expect(service.estimate).toHaveBeenCalledTimes(2);expect(service.estimate.mock.calls[1][0].departureTime).toBe("2026-09-16T11:10:00.000Z");
  expect(result.status).toBe("FEASIBLE");expect(result.canReserve).toBe(false);
 });
 it("does not call a paid provider with unreconciled calendars",async()=>{
  const service={estimate:vi.fn(estimate)};expect((await assessTravelPlan(request,service,{...context,calendarReady:false})).status).toBe("CALENDAR_REVIEW_REQUIRED");expect(service.estimate).not.toHaveBeenCalled();
 });
 it("blocks a conflict during travel, not only during the meeting",async()=>expect((await assessTravelPlan(request,{estimate},{...context,busy:[{start:"2026-09-16T09:05:00Z",end:"2026-09-16T09:10:00Z"}]})).status).toBe("CALENDAR_CONFLICT"));
 it("blocks a late onward arrival",async()=>expect((await assessTravelPlan({...request,availableUntil:"2026-09-16T11:15:00Z"},{estimate},context)).status).toBe("NOT_FEASIBLE"));
 it("rejects evidence for the wrong destination",async()=>await expect(assessTravelPlan(request,{estimate:async r=>({...await estimate(r),destinationPlaceId:"wrong"})},context)).rejects.toThrow("valda planen"));
 it("rejects a stale estimate",async()=>expect((await assessTravelPlan(request,{estimate:async r=>({...await estimate(r),checkedAt:"2026-09-16T07:50:00Z"})},context)).status).toBe("TRAVEL_TIME_UNKNOWN"));
 it("does not treat provider failure as zero travel time",async()=>await expect(assessTravelPlan(request,{estimate:async()=>{throw new Error("timeout");}},context)).rejects.toThrow("timeout"));
});
