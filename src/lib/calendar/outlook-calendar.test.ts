import { describe,it,expect,vi } from "vitest";
import { OutlookCalendarReader,normalizeOutlookEvent } from "./outlook-calendar";
const event={id:"one",subject:"Meeting",start:{dateTime:"2026-09-16T09:00:00.0000000",timeZone:"UTC"},end:{dateTime:"2026-09-16T10:00:00.0000000",timeZone:"UTC"},showAs:"busy"};
const range={start:"2026-09-16T00:00:00Z",end:"2026-09-17T00:00:00Z"};
describe("Outlook source calendar",()=>{
  it("normalizes UTC without using machine timezone",()=>{
    expect(normalizeOutlookEvent(event,"work")).toMatchObject({start:"2026-09-16T09:00:00.000Z",blocksAvailability:true});
  });
  it("does not block declined or cancelled requests",()=>{
    expect(normalizeOutlookEvent({...event,responseStatus:{response:"declined"}},"work").blocksAvailability).toBe(false);
    expect(normalizeOutlookEvent({...event,isCancelled:true},"work").blocksAvailability).toBe(false);
  });
  it("rejects unknown timezone rather than guessing",()=>{
    expect(()=>normalizeOutlookEvent({...event,start:{...event.start,timeZone:"W. Europe Standard Time"}},"work")).toThrow();
  });
  it("reads every page and preserves calendar identity",async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({value:[],"@odata.nextLink":"https://graph.microsoft.com/v1.0/me/calendars/work/calendarView?$skiptoken=next"}))).mockResolvedValueOnce(new Response(JSON.stringify({value:[event]})));
    expect(await new OutlookCalendarReader("test",fetcher).getEvents("work",range)).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("never sends a token to a foreign pagination host",async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({value:[],"@odata.nextLink":"https://example.com/steal"})));
    await expect(new OutlookCalendarReader("test",fetcher).getEvents("work",range)).rejects.toThrow("Untrusted");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not return partial results after an API error",async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({value:[event],"@odata.nextLink":"https://graph.microsoft.com/v1.0/me/calendars/work/calendarView?next=1"}))).mockResolvedValueOnce(new Response("",{status:403}));
    await expect(new OutlookCalendarReader("test",fetcher).getEvents("work",range)).rejects.toThrow("403");
  });
});
