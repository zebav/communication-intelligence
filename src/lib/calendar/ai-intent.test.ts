import {afterEach,describe,expect,it,vi} from "vitest";
import {analyzeCalendarIntent,groundCalendarIntent} from "./ai-intent";
const messages=[{id:"one",body:"Kan vi ses 2026-09-21 kl 12?",sentAt:"2026-09-16T10:00:00Z",direction:"incoming",source:"whatsapp"}];
const proposal={operation:"propose",summary:"Lunch",meetingType:"LUNCH",date:"2026-09-21",timeText:"12",locationText:"",durationMinutes:null,questions:[],evidence:[{messageId:"one",quote:messages[0].body}]};
afterEach(()=>vi.unstubAllEnvs());
describe("grounded calendar proposals",()=>{
 it("retains a literal date with exact evidence",()=>expect(groundCalendarIntent(proposal,messages).date).toBe("2026-09-21"));
 it("rejects fabricated evidence and message IDs",()=>{
  expect(()=>groundCalendarIntent({...proposal,evidence:[{messageId:"one",quote:"Book now"}]},messages)).toThrow();
  expect(()=>groundCalendarIntent({...proposal,evidence:[{messageId:"other",quote:messages[0].body}]},messages)).toThrow();
 });
 it("requires evidence for actions",()=>expect(()=>groundCalendarIntent({...proposal,evidence:[]},messages)).toThrow());
 it("does not anchor an inferred date silently",()=>{
  const result=groundCalendarIntent({...proposal,date:"2026-09-22"},messages);
  expect(result.date).toBeNull();expect(result.questions).toHaveLength(1);
 });
 it("rejects impossible dates",()=>expect(()=>groundCalendarIntent({...proposal,date:"2026-02-30"},messages)).toThrow());
 it("keeps cancellations distinct from proposals",()=>expect(groundCalendarIntent({...proposal,operation:"cancel"},messages).operation).toBe("cancel"));
 it("uses non-storing structured API output without booking tools",async()=>{
  vi.stubEnv("OPENAI_API_KEY","synthetic");vi.stubEnv("OPENAI_CALENDAR_MODEL","configured-model");
  const transport=vi.fn().mockResolvedValue(new Response(JSON.stringify({output:[{content:[{type:"output_text",text:JSON.stringify(proposal)}]}]})));
  expect((await analyzeCalendarIntent({ownerId:"owner",timezone:"Europe/Stockholm",messages},transport)).date).toBe(proposal.date);
  const sent=JSON.parse(transport.mock.calls[0][1].body);
  expect(sent.store).toBe(false);expect(sent.tools).toBeUndefined();expect(sent.safety_identifier).not.toBe("owner");
 });
});
