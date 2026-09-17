import {afterEach,it,expect,vi} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {CalendarCommitmentReview} from "./calendar-commitment-review";
import type {CalendarEvent} from "@/lib/calendar/types";
afterEach(cleanup);
it("requires a review and only batches missing future blocking events",()=>{
 const base:CalendarEvent={id:"a",calendarId:"s",title:"Meeting",timezone:"UTC",start:"2099-01-01T10:00:00Z",end:"2099-01-01T11:00:00Z",status:"confirmed",allDay:false,blocksAvailability:true};
 const copy=vi.fn();render(<CalendarCommitmentReview name="Calendar" account="me@example.com" events={[base,{...base,id:"b",blocksAvailability:false},{...base,id:"c",start:"2020-01-01T10:00:00Z",end:"2020-01-01T11:00:00Z"}]} master={[]} now={Date.parse("2026-01-01")} busy={false} onCopy={vi.fn()} onCopyMany={copy} format={v=>v}/>);
 fireEvent.click(screen.getByText(/Calendar · me@example.com/));
 fireEvent.click(screen.getByText("Välj alla 1 saknade framtida poster i urvalet"));expect(copy).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText("Granska 1 valda kopior"));expect(copy).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText("Godkänn och för över de valda kopiorna utan utskick"));expect(copy).toHaveBeenCalledWith([base]);
});
