import type {CalendarEvent} from './types';
export type DisplayCalendar={id:string;label:string;master:boolean;color:string};
export function calendarDisplay(sources:{id:string;account_id:string;name:string;is_master:boolean;snapshot:CalendarEvent[]}[],accounts:{id:string;address:string}[]) {
 const palette=['#80b9ff','#d4a1ff','#ffc47d','#ff9fb9','#89d8dd'];
 const accountIds=[...new Set(sources.filter(s=>!s.is_master).map(s=>s.account_id))].sort();
 const calendars:DisplayCalendar[]=sources.map(s=>({id:s.id,label:`${s.is_master?'Master':'Extern'} · ${s.name} · ${accounts.find(a=>a.id===s.account_id)?.address??'Okänt konto'}`,master:s.is_master,color:s.is_master?'#82d5af':palette[accountIds.indexOf(s.account_id)%palette.length]}));
 // Provider event IDs are only unique within their source, not across accounts.
 const events=sources.flatMap(s=>s.snapshot.map(e=>({...e,id:JSON.stringify([s.id,e.id]),calendarId:s.id})));
 return {calendars,events};
}
