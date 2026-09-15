import React from "react";
import {createRoot} from "react-dom/client";
import {CalendarWorkspace} from "../src/components/calendar-workspace";
import "../src/app/globals.css";
import {suggestSlots} from "../src/lib/calendar/scheduling";
import {zonedInstant} from "../src/lib/calendar/time";
import {defaultPlanningPreferences} from "../src/lib/calendar/planning-preferences";
import {CalendarEventActions} from "../src/components/calendar-event-actions";
import type {CalendarEvent} from "../src/lib/calendar/types";
// Synthetic local preview only: no production credentials or external writes.
const today=new Date().toLocaleDateString("sv-SE");
const snapshot={accounts:[{id:"google",provider:"google",address:"test@example.invalid"},{id:"outlook",provider:"microsoft",address:"work@example.invalid"}],workspace:{timezone:"Europe/Stockholm",provisioning:"ready"},sources:[{id:"master",account_id:"google",name:"Communication Intelligence – Master",is_master:true,enabled:true,snapshot:[],reviewed_snapshot:[],synced_at:new Date().toISOString(),sync_error:null},{id:"work",account_id:"outlook",name:"Arbetskalender",is_master:false,enabled:true,snapshot:[],reviewed_snapshot:[],synced_at:new Date().toISOString(),sync_error:null}],holds:[] as {id:string;title:string;starts_at:string;ends_at:string;status:string;expires_at:string;preparation_minutes:number;recovery_minutes:number}[]};
let planningRules=defaultPlanningPreferences;
const testEvent:CalendarEvent={id:"event",calendarId:"master",title:"Syntetisk testbokning",timezone:"Europe/Stockholm",start:new Date(Date.now()+86400000).toISOString(),end:new Date(Date.now()+90000000).toISOString(),allDay:false,status:"confirmed",blocksAvailability:true};
let testPlan:Record<string,unknown>|null=null;
window.fetch=async(_input,init)=>{
 if(String(_input).includes('/calendar/intents'))return Response.json({proposals:[]});
 if(String(_input).includes('/calendar/actions')) {
  if(init?.method!=='POST')return Response.json({plans:testPlan?[testPlan]:[]});
  const body=JSON.parse(String(init.body));
  if(body.action==='prepare'){testPlan={id:'test-plan',status:'proposed',kind:body.request.kind,new_title:body.request.newTitle,target_start:body.request.targetStart,target_end:body.request.targetEnd,before_event:testEvent};return Response.json({plan:testPlan});}
  if(body.action==='dismiss'){testPlan=null;return Response.json({dismissed:true});}
  if(body.action==='execute'){testPlan=null;return Response.json({completed:true});}
 }
 if(String(_input).endsWith('/planning')) {
  if(init?.method==='POST') {const body=JSON.parse(String(init.body));if(body.action==='preferences'){planningRules=body.rules;return Response.json({rules:planningRules});}return Response.json({error:'Maps disabled in synthetic preview'},{status:503});}
  return Response.json({rules:planningRules,mapsEnabled:false});
 }
 if(init?.method==="POST") {
  const body=JSON.parse(String(init.body));
  if(body.action==="suggest") return Response.json({slots:suggestSlots({windows:[{start:zonedInstant(body.date+"T08:00","Europe/Stockholm"),end:zonedInstant(body.date+"T21:00","Europe/Stockholm")}],events:[],holds:[],preferences:{timezone:"Europe/Stockholm",durationMinutes:body.duration,preparationMinutes:body.preparation,recoveryMinutes:body.recovery,stepMinutes:30},physical:body.physical,reconciled:true,syncFresh:true,now:new Date().toISOString()})});
  if(body.action==="hold") snapshot.holds.push({id:"test-hold",title:body.title,starts_at:body.start,ends_at:body.end,status:"active",expires_at:new Date(Date.now()+1200000).toISOString(),preparation_minutes:body.preparation,recovery_minutes:body.recovery});
  if(body.action==="confirm") snapshot.holds[0].status="confirmed";
  if(body.action==="release") snapshot.holds[0].status="released";
  return Response.json({success:true});
 }
 return Response.json(snapshot);
};
createRoot(document.getElementById("root")!).render(<><CalendarWorkspace conversations={[{id:"synthetic",person:"Testkontakt",title:"Planera ett möte",text:`Har du tid för ett möte ${today}? Vi behöver ungefär 45 minuter.`}]}/><CalendarEventActions sourceId="master" event={testEvent} onDone={async()=>{}} onClose={()=>{}}/></>);
