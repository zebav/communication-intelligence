import { describe, expect, it } from "vitest";
import { microsoftRedirectUri } from "./microsoft-oauth";

describe("Microsoft redirect URI", () => {
  it("prefers the explicitly configured stable callback", () => {
    expect(microsoftRedirectUri("https://temporary.vercel.app", { MICROSOFT_REDIRECT_URI: "https://app.example.com/api/connectors/microsoft/callback", VERCEL_PROJECT_PRODUCTION_URL: "project.vercel.app" })).toBe("https://app.example.com/api/connectors/microsoft/callback");
  });
  it("uses Vercel's stable production domain instead of a deployment domain", () => {
    expect(microsoftRedirectUri("https://temporary.vercel.app", { VERCEL_PROJECT_PRODUCTION_URL: "communication-intelligence-blush.vercel.app" })).toBe("https://communication-intelligence-blush.vercel.app/api/connectors/microsoft/callback");
  });
  it("keeps localhost usable outside Vercel", () => {
    expect(microsoftRedirectUri("http://localhost:3000", {})).toBe("http://localhost:3000/api/connectors/microsoft/callback");
  });
});
