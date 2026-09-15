import {describe,it,expect} from "vitest";
import {calendarStartDestination} from "./callback";
describe("calendar canonical callback",()=>{
 const callback="https://branch.example/api/connectors/google/callback";
 it("accepts the branch host when Next resolves to a deployment URL",()=>expect(calendarStartDestination(callback,"https://deployment.example/api/calendar/connect/google","branch.example")).toBeNull());
 it("moves a different deployment to the configured branch before setting cookies",()=>expect(calendarStartDestination(callback,"https://old.example/api/calendar/connect/google","old.example")).toBe("https://branch.example/api/calendar/connect/google"));
 it("does not redirect to an untrusted host",()=>expect(calendarStartDestination(callback,"https://old.example/api/calendar/connect/google","evil.example")).toBe("https://branch.example/api/calendar/connect/google"));
});
