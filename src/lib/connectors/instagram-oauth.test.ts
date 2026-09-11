import { describe, expect, it } from "vitest";
import { instagramAuthorizationUrl, instagramRedirectUri } from "./instagram-oauth";

describe("Instagram OAuth", () => {
  it("keeps OAuth on the stable production callback", () => {
    expect(instagramRedirectUri("https://temporary.vercel.app", { VERCEL_PROJECT_PRODUCTION_URL: "communication-intelligence-blush.vercel.app" }))
      .toBe("https://communication-intelligence-blush.vercel.app/api/connectors/instagram/callback");
  });

  it("requests only the permissions required for Instagram messaging", () => {
    const url = instagramAuthorizationUrl({ appId: "123", appSecret: "secret", redirectUri: "https://app.example.com/api/connectors/instagram/callback" }, "state");
    expect(url.origin).toBe("https://www.instagram.com");
    expect(url.searchParams.get("scope")).toBe("instagram_business_basic,instagram_business_manage_messages");
    expect(url.searchParams.get("state")).toBe("state");
  });
});
