import {describe,it,expect,vi} from "vitest";
import {eventContextSchema} from "./event-context";
import {GooglePlacesRoutes} from "./places-routing";
import {GoogleWeather,summarizeWeather} from "./weather";

describe("calendar context",()=>{
 const value={sourceId:"00000000-0000-4000-8000-000000000001",eventId:"event",revision:0,personIds:[],conversationId:null,locationKind:"unknown",googlePlaceId:null,userPlaceLabel:"Home",meetingUrl:""};
 it("accepts manual locations without Maps",()=>expect(eventContextSchema.safeParse(value).success).toBe(true));
 it("rejects duplicate people, wrong kind and unsafe meeting links",()=>{
  expect(eventContextSchema.safeParse({...value,personIds:[value.sourceId,value.sourceId]}).success).toBe(false);
  expect(eventContextSchema.safeParse({...value,googlePlaceId:"place"}).success).toBe(false);
  for(const meetingUrl of ["javascript:alert(1)","http://example.org","https://user:secret@example.org"])
   expect(eventContextSchema.safeParse({...value,locationKind:"digital",meetingUrl}).success).toBe(false);
 });
});
describe("Maps cost guards",()=>{
 it("does not call Google when reservation fails",async()=>{
  const transport=vi.fn(),reserve=vi.fn().mockRejectedValue(new Error("cap"));
  await expect(new GooglePlacesRoutes("test",transport,reserve).search("Stockholm")).rejects.toThrow("cap");
  expect(transport).not.toHaveBeenCalled();
 });
 it("reserves a route before a failed request and never retries automatically",async()=>{
  const transport=vi.fn().mockResolvedValue(new Response("",{status:503})),reserve=vi.fn().mockResolvedValue(undefined);
  await expect(new GooglePlacesRoutes("test",transport,reserve).estimate({originPlaceId:"a",destinationPlaceId:"b",mode:"DRIVE",departureTime:new Date(Date.now()+3600000).toISOString()})).rejects.toThrow();
  expect(reserve).toHaveBeenCalledExactlyOnceWith("route");expect(transport).toHaveBeenCalledTimes(1);
 });
});
describe("weather advice",()=>{
 const request={latitude:59,longitude:18,at:"2026-10-01T12:00:00Z"};
 const part={interval:{startTime:"2026-10-01T05:00:00Z",endTime:"2026-10-01T17:00:00Z"},precipitation:{probability:{percent:80}},weatherCondition:{description:{text:"Regn"}}};
 it("uses the period covering the meeting, never assumes missing data is good weather",()=>{
  expect(summarizeWeather({forecastDays:[{daytimeForecast:part}]},request).advice).toContain("inomhus");
  expect(summarizeWeather({forecastDays:[{daytimeForecast:part}]},{...request,at:"2026-11-01T12:00:00Z"}).available).toBe(false);
 });
 it("does not make a paid request beyond the forecast horizon",async()=>{
  const reserve=vi.fn(),transport=vi.fn();
  expect((await new GoogleWeather("test",reserve,transport).forecast({...request,at:new Date(Date.now()+20*86400000).toISOString()})).available).toBe(false);
  expect(reserve).not.toHaveBeenCalled();expect(transport).not.toHaveBeenCalled();
 });
 it("fails closed when the weather budget cannot be reserved",async()=>{
  const reserve=vi.fn().mockRejectedValue(new Error("cap")),transport=vi.fn();
  await expect(new GoogleWeather("test",reserve,transport).forecast({...request,at:new Date(Date.now()+3600000).toISOString()})).rejects.toThrow("cap");
  expect(transport).not.toHaveBeenCalled();
 });
});
