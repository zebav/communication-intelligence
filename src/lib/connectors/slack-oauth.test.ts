import { describe, expect, it } from "vitest";
import { slackAuthorizationUrl, slackRedirectUri } from "./slack-oauth";

describe("Slack OAuth", () => {
  it("uses an explicitly registered callback ahead of deployment URLs", () => {
    expect(slackRedirectUri("https://preview.vercel.app", { SLACK_REDIRECT_URI: "https://www.solvani.app/api/connectors/slack/callback", VERCEL_PROJECT_PRODUCTION_URL: "other.vercel.app" })).toBe("https://www.solvani.app/api/connectors/slack/callback");
  });

  it("requests only the read-only pilot scopes", () => {
    const url = new URL(slackAuthorizationUrl({ clientId: "id", clientSecret: "secret", redirectUri: "https://www.solvani.app/api/connectors/slack/callback" }, "state", "challenge"));
    expect(url.searchParams.get("scope")).toBe("channels:read,channels:history,im:read,im:history,users:read");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});
