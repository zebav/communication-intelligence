import { describe, expect, it } from "vitest";
import { slackAuthorizationUrl, slackRedirectUri } from "./slack-oauth";

describe("Slack OAuth", () => {
  it("uses an explicitly registered callback ahead of deployment URLs", () => {
    expect(slackRedirectUri("https://preview.vercel.app", { SLACK_REDIRECT_URI: "https://www.solvani.app/api/connectors/slack/callback", VERCEL_PROJECT_PRODUCTION_URL: "other.vercel.app" })).toBe("https://www.solvani.app/api/connectors/slack/callback");
  });

  it("requests owner-authorised, read-only scopes", () => {
    const url = new URL(slackAuthorizationUrl({ clientId: "id", clientSecret: "secret", redirectUri: "https://www.solvani.app/api/connectors/slack/callback" }, "state", "challenge"));
    expect(url.origin + url.pathname).toBe("https://slack.com/oauth/v2_user/authorize");
    expect(url.searchParams.get("scope")).toBeNull();
    expect(url.searchParams.get("user_scope")).toBe("channels:read,channels:history,groups:read,groups:history,im:read,im:history,mpim:read,mpim:history,users:read");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});
