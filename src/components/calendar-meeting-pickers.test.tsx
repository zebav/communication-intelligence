import {afterEach,describe,it,expect,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {MeetingPeoplePicker,MeetingPlacePicker} from "./calendar-meeting-pickers";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("meeting pickers",()=>{
 it("selects a contact without silently inviting an address",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>({people:[{id:"p",display_name:"Anna",organization:"Team",emails:["a@example.com"]}]})}));
  const onChange=vi.fn();render(<MeetingPeoplePicker value={[]} onChange={onChange}/>);
  fireEvent.change(screen.getByLabelText("Sök kontakt efter namn"),{target:{value:"Anna"}});fireEvent.click(screen.getByText("Sök kontakt"));
  fireEvent.click(await screen.findByText("Lägg till Anna · Team"));
  expect(onChange).toHaveBeenCalledWith([expect.objectContaining({id:"p",invitationEmail:""})]);
 });
 it("explains missing email and allows removing a selected person",()=>{
  const onChange=vi.fn();render(<MeetingPeoplePicker value={[{id:"p",display_name:"Anna",organization:null,emails:[],invitationEmail:""}]} onChange={onChange}/>);
  expect(screen.getByText(/Ingen e-postadress sparad/)).toBeTruthy();fireEvent.click(screen.getByText("Ta bort Anna"));expect(onChange).toHaveBeenCalledWith([]);
 });
 it("selects Maps location without requiring travel planning",async()=>{
  const place={id:"place",name:"Central",address:"Stockholm",mapsUrl:"https://maps.google.com/"};
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>({places:[place]})}));const onChange=vi.fn();
  render(<MeetingPlacePicker value={null} onChange={onChange} enabled/>);fireEvent.change(screen.getByLabelText("Sök plats eller adress"),{target:{value:"Central"}});fireEvent.click(screen.getByText("Sök i Google Maps"));
  await waitFor(()=>expect(screen.getByText("Välj plats")).toBeTruthy());fireEvent.click(screen.getByText("Välj plats"));expect(onChange).toHaveBeenCalledWith(place);
 });
});
