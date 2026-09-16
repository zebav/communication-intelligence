import React from "react";
import {createRoot} from "react-dom/client";
import {CalendarWorkspace} from "../src/components/calendar-workspace";
import "../src/app/globals.css";
import {suggestSlots} from "../src/lib/calendar/scheduling";
import {zonedInstant} from "../src/lib/calendar/time";
import {defaultPlanningPreferences} from "../src/lib/calendar/planning-preferences";
import type {CalendarEvent} from "../src/lib/calendar/types";
import type {MeetingDetails} from "../src/lib/calendar/meeting-details";
// Synthetic local preview only: no production credentials or external writes.
if(!["localhost","127.0.0.1","[::1]"].includes(window.location.hostname))throw new Error("Synthetic calendar preview is local-only");
const today=new Date().toLocaleDateString("sv-SE");
const snapshot={accounts:[{id:"google",provider:"google",address:"test@example.invalid"},{id:"outlook",provider:"microsoft",address:"work@example.invalid"}],workspace:{timezone:"Europe/Stockholm",provisioning:"ready"},sources:[{id:"master",account_id:"google",name:"Communication Intelligence – Master",is_master:true,enabled:true,snapshot:[] as CalendarEvent[],reviewed_snapshot:[],synced_at:new Date().toISOString(),sync_error:null},{id:"work",account_id:"outlook",name:"Arbetskalender",is_master:false,enabled:true,snapshot:[],reviewed_snapshot:[],synced_at:new Date().toISOString(),sync_error:null}],holds:[] as {id:string;title:string;starts_at:string;ends_at:string;status:string;expires_at:string;preparation_minutes:number;recovery_minutes:number;meeting_details?:MeetingDetails}[]};
let planningRules=defaultPlanningPreferences;
const testEvent:CalendarEvent={id:"event",calendarId:"master",title:"Syntetisk testbokning",timezone:"Europe/Stockholm",start:new Date(Date.now()+86400000).toISOString(),end:new Date(Date.now()+90000000).toISOString(),allDay:false,status:"confirmed",blocksAvailability:true};
snapshot.sources[0].snapshot=[testEvent];
let testPlan:Record<string,unknown>|null=null;
let testContext:Record<string,unknown>|null=null;
window.fetch=async(_input,init)=>{
 const path=String(_input);
 if(!path.startsWith('/api/calendar'))throw new Error('Unexpected request blocked by isolated calendar preview');
 if(path.includes('/calendar/context')){
  if(init?.method==='POST'){
   const b=JSON.parse(String(init.body));
   if(b.revision!==(testContext?.revision??0))return Response.json({error:'Context revision mismatch'},{status:409});
   testContext={revision:b.revision+1,person_ids:b.personIds,conversation_id:b.conversationId,location_kind:b.locationKind,user_place_label:b.userPlaceLabel,meeting_url:b.meetingUrl,google_place_id:b.googlePlaceId};
  }
  return Response.json({context:testContext,people:path.includes('search=')||Array.isArray(testContext?.person_ids)&&testContext.person_ids.length?[{id:'test-person',display_name:'Syntetisk testkontakt',organization:'TEST – inte en riktig kontakt'}]:[]});
 }
 if(String(_input).includes('/calendar/intents'))return Response.json({proposals:[]});
 if(String(_input).includes('/calendar/actions')) {
  if(init?.method!=='POST')return Response.json({plans:testPlan?[testPlan]:[]});
  const body=JSON.parse(String(init.body));
  if(body.action==='prepare'){testPlan={id:'test-plan',status:'proposed',kind:body.request.kind,new_title:body.request.newTitle,target_start:body.request.targetStart,target_end:body.request.targetEnd,before_event:testEvent,details:{recipients:body.request.details?.attendees??[],edit:body.request.details}};return Response.json({plan:testPlan});}
  if(body.action==='dismiss'){testPlan=null;return Response.json({dismissed:true});}
  if(body.action==='execute'){
   if(!testPlan)return Response.json({error:'Review required'},{status:409});
   if(testPlan.kind==='move'){testEvent.start=String(testPlan.target_start);testEvent.end=String(testPlan.target_end);}
   if(testPlan.kind==='rename')testEvent.title=String(testPlan.new_title);
   if(testPlan.kind==='cancel')testEvent.status='cancelled';
   const notificationsRequested=Boolean((testPlan.details as {recipients:string[]})?.recipients.length);
   if(notificationsRequested&&!body.approvedNotifications)return Response.json({error:'Approval required'},{status:409});
   testPlan=null;return Response.json({completed:true,notificationsRequested});
  }
 }
 if(String(_input).endsWith('/planning')) {
  if(init?.method==='POST') {const body=JSON.parse(String(init.body));if(body.action==='preferences'){planningRules=body.rules;return Response.json({rules:planningRules});}return Response.json({error:'Maps disabled in synthetic preview'},{status:503});}
  return Response.json({rules:planningRules,mapsEnabled:false});
 }
 if(init?.method==="POST") {
  const body=JSON.parse(String(init.body));
  if(body.action==="suggest") return Response.json({slots:suggestSlots({windows:[{start:zonedInstant(body.date+"T08:00","Europe/Stockholm"),end:zonedInstant(body.date+"T21:00","Europe/Stockholm")}],events:[],holds:[],preferences:{timezone:"Europe/Stockholm",durationMinutes:body.duration,preparationMinutes:body.preparation,recoveryMinutes:body.recovery,stepMinutes:30},physical:body.physical,reconciled:true,syncFresh:true,now:new Date().toISOString()})});
  if(body.action==="hold") {const hold={id:"test-hold",title:body.title,starts_at:body.start,ends_at:body.end,status:"active",expires_at:new Date(Date.now()+1200000).toISOString(),preparation_minutes:body.preparation,recovery_minutes:body.recovery,meeting_details:body.details};snapshot.holds.push(hold);return Response.json({success:true,hold});}
  if(body.action==="confirm") snapshot.holds[0].status="confirmed";
  if(body.action==="release") snapshot.holds[0].status="released";
  return Response.json({success:true});
 }
 return Response.json(snapshot);
};
createRoot(document.getElementById("root")!).render(<CalendarWorkspace conversations={[{id:"synthetic",person:"Testkontakt",title:"Planera ett möte",text:`Har du tid för ett möte ${today}? Vi behöver ungefär 45 minuter.`}]}/>);
