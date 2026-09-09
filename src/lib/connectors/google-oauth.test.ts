import { describe, expect, it } from "vitest";
import { googleRedirectUri } from "./google-oauth";

describe("Google redirect URI", () => {
  it("prefers an explicitly configured callback", () => {
    expect(googleRedirectUri("https://temporary.vercel.app", { GOOGLE_REDIRECT_URI: "https://app.example.com/api/connectors/google/callback" })).toBe("https://app.example.com/api/connectors/google/callback");
  });

  it("uses the stable Vercel production domain", () => {
    expect(googleRedirectUri("https://temporary.vercel.app", { VERCEL_PROJECT_PRODUCTION_URL: "communication-intelligence-blush.vercel.app" })).toBe("https://communication-intelligence-blush.vercel.app/api/connectors/google/callback");
  });
});
