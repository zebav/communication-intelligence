import React from "react";
import {createRoot} from "react-dom/client";
import {CalendarWorkspace} from "../src/components/calendar-workspace";
import "../src/app/globals.css";
import {suggestSlots} from "../src/lib/calendar/scheduling";
import {zonedInstant} from "../src/lib/calendar/time";
// Synthetic local preview only: no production credentials or external writes.
const today=new Date().toLocaleDateString("sv-SE");
const snapshot={accounts:[{id:"google",provider:"google",address:"test@example.invalid"},{id:"outlook",provider:"microsoft",address:"work@example.invalid"}],workspace:{timezone:"Europe/Stockholm",provisioning:"ready"},sources:[{id:"master",account_id:"google",name:"Communication Intelligence – Master",is_master:true,enabled:true,snapshot:[],reviewed_snapshot:[],synced_at:new Date().toISOString(),sync_error:null},{id:"work",account_id:"outlook",name:"Arbetskalender",is_master:false,enabled:true,snapshot:[],reviewed_snapshot:[],synced_at:new Date().toISOString(),sync_error:null}],holds:[] as {id:string;title:string;starts_at:string;ends_at:string;status:string;expires_at:string;preparation_minutes:number;recovery_minutes:number}[]};
window.fetch=async(_input,init)=>{
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
createRoot(document.getElementById("root")!).render(<><CalendarWorkspace conversations={[{id:"synthetic",person:"Testkontakt",title:"Planera ett möte",text:`Har du tid för ett möte ${today}? Vi behöver ungefär 45 minuter.`}]}/></>);
