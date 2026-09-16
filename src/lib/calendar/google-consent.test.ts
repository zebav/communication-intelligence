import { describe, expect, it } from "vitest";
import { grantedGoogleScopes, validateCalendarGrant } from "./google-consent";
import { googleCalendarScopes } from "./google-calendar";
import { googleAuthorizationUrl } from "../connectors/google-oauth";
const config={clientId:"test",clientSecret:"unused",redirectUri:"https://example.com/callback"};
describe("separate calendar consent",()=>{
  it("does not add calendar access to the existing Gmail flow",()=>{
    expect(googleAuthorizationUrl(config,"state","challenge").searchParams.get("scope")).not.toContain("calendar");
  });
  it("requests calendar consent without new Gmail permissions",()=>{
    const url=googleAuthorizationUrl(config,"state","challenge","calendar");
    expect(url.searchParams.get("scope")).not.toContain("gmail");
    expect(url.searchParams.get("scope")).toContain("calendar.app.created");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
  it("requires actual granted scopes, not requested scopes",()=>{
    expect(validateCalendarGrant(undefined).complete).toBe(false);
    expect(validateCalendarGrant("openid email https://www.googleapis.com/auth/gmail.modify").complete).toBe(false);
    expect(validateCalendarGrant(googleCalendarScopes.join(" ")).complete).toBe(true);
  });
  it("does not claim write permission for partial read consent",()=>{
    const result=validateCalendarGrant("https://www.googleapis.com/auth/calendar.readonly");
    expect(result.capabilities.readEvents).toBe(true);
    expect(result.capabilities.manageAppCreatedCalendar).toBe(false);
    expect(result.complete).toBe(false);
  });
  it("normalizes repeated scopes",()=>{
    expect(grantedGoogleScopes(" email  email openid ")).toEqual(["email","openid"]);
  });
});
