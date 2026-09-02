import { describe, expect, it } from "vitest";
import { microsoftGraphConnector } from "./microsoft-graph";

describe("microsoftGraphConnector", () => {
  it("supports both organizational and personal Microsoft accounts", () => {
    expect(microsoftGraphConnector.accountAudience).toBe("work-school-and-personal");
    expect(microsoftGraphConnector.authorization).toBe("oauth2-web-server");
  });

  it("declares the Outlook synchronization capabilities", () => {
    expect(microsoftGraphConnector.capabilities.fullSync).toBe(true);
    expect(microsoftGraphConnector.capabilities.incrementalSync).toBe(true);
    expect(microsoftGraphConnector.capabilities.pushNotifications).toBe(true);
  });

  it("requests delegated mail access and keeps destructive automation disabled", () => {
    expect(microsoftGraphConnector.scopes).toEqual([
      "openid", "profile", "offline_access", "User.Read", "Mail.ReadWrite", "Mail.Send",
    ]);
    expect(microsoftGraphConnector.capabilities.sendWithApproval).toBe(true);
    expect(microsoftGraphConnector.capabilities.permanentDelete).toBe(false);
    expect(microsoftGraphConnector.capabilities.unsubscribe).toBe(false);
  });
});
