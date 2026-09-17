import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {CalendarBoard} from "./calendar-board";
vi.mock("./calendar-meeting-composer",()=>({CalendarMeetingComposer:({initialStart,initialEnd}:{initialStart:string;initialEnd:string})=><div data-testid="draft">{initialStart} / {initialEnd}</div>}));
beforeEach(()=>{
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};
 HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");this.dispatchEvent(new Event("close"));};
});
afterEach(cleanup);
const base={events:[],calendars:[],date:"2026-09-18",timezone:"Europe/Stockholm",onDate:vi.fn(),onDone:vi.fn().mockResolvedValue(undefined)};
describe("calendar manual entry",()=>{
 it("opens Add with selected calendar date, without making a booking",()=>{
  render(<CalendarBoard {...base}/>);fireEvent.click(screen.getByRole("button",{name:"+ Lägg till möte"}));
  expect(screen.getByRole("dialog").hasAttribute("open")).toBe(true);
  expect(screen.getByTestId("draft").textContent).toBe("2026-09-18T09:00 / 2026-09-18T09:30");
  expect(base.onDone).not.toHaveBeenCalled();
 });
 it("uses the clicked day and hour and opens a fresh draft after closing",()=>{
  render(<CalendarBoard {...base}/>);
  fireEvent.click(screen.getByRole("button",{name:"Lägg till möte 2026-09-17 klockan 23:00"}));
  expect(screen.getByTestId("draft").textContent).toBe("2026-09-17T23:00 / 2026-09-17T23:30");
  fireEvent.click(screen.getByRole("button",{name:"Stäng"}));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Lägg till möte 2026-09-18 klockan 10:00"}));
  expect(screen.getByTestId("draft").textContent).toBe("2026-09-18T10:00 / 2026-09-18T10:30");
 });
 it("does not offer booking before a master calendar is available",()=>{
  render(<CalendarBoard {...base} onDone={undefined}/>);
  expect(screen.queryByRole("button",{name:"+ Lägg till möte"})).toBeNull();
 });
});
