import {it,expect} from 'vitest';
import {calendarDisplay} from './display';
import type {CalendarEvent} from './types';
it('displays external sources without changing snapshots or merging matching provider IDs',()=>{
 const event:CalendarEvent={id:'same',calendarId:'provider',title:'Meeting',start:'2026-09-16T10:00:00Z',end:'2026-09-16T11:00:00Z',timezone:'UTC',allDay:false,status:'confirmed',blocksAvailability:true};
 const sources=[{id:'master',account_id:'g',name:'Master',is_master:true,snapshot:[]},{id:'work',account_id:'m',name:'Work',is_master:false,snapshot:[event]},{id:'personal',account_id:'g',name:'Personal',is_master:false,snapshot:[event]}];
 const before=JSON.stringify(sources);
 const result=calendarDisplay(sources,[{id:'m',address:'work@example.com'},{id:'g',address:'personal@example.com'}]);
 expect(result.events).toHaveLength(2);
 expect(new Set(result.events.map(e=>e.id)).size).toBe(2);
 expect(result.calendars[1].label).toContain('work@example.com');
 expect(result.calendars[1].master).toBe(false);
 expect(JSON.stringify(sources)).toBe(before);
});
it('does not show an external event again once its approved copy exists in master',()=>{
 const event:CalendarEvent={id:'source-event',calendarId:'provider',title:'Meeting',start:'2026-09-16T10:00:00Z',end:'2026-09-16T11:00:00Z',timezone:'UTC',allDay:false,status:'confirmed',blocksAvailability:true};
 const masterEvent:CalendarEvent={...event,id:'master-event',calendarId:'master'};
 const sources=[{id:'master',account_id:'g',name:'Master',is_master:true,snapshot:[masterEvent]},{id:'work',account_id:'m',name:'Work',is_master:false,snapshot:[event]}];
 const result=calendarDisplay(sources,[{id:'m',address:'work@example.com'},{id:'g',address:'personal@example.com'}],[{source_id:'work',source_event_id:'source-event',master_source_id:'master',master_event_id:'master-event'}]);
 expect(result.events).toHaveLength(1);
 expect(result.events[0].calendarId).toBe('master');
});
