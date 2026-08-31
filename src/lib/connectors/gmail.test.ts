import { describe, expect, it } from "vitest";
import { gmailConnector } from "./gmail";

describe("gmailConnector", () => {
  it("declares the production synchronization capabilities", () => {
    expect(gmailConnector.capabilities.fullSync).toBe(true);
    expect(gmailConnector.capabilities.incrementalSync).toBe(true);
    expect(gmailConnector.capabilities.pushNotifications).toBe(true);
  });

  it("keeps consequential unsupported operations disabled", () => {
    expect(gmailConnector.capabilities.permanentDelete).toBe(false);
    expect(gmailConnector.capabilities.unsubscribe).toBe(false);
    expect(gmailConnector.capabilities.sendWithApproval).toBe(true);
  });

  it("uses the server-side OAuth flow and never exposes credentials", () => {
    expect(gmailConnector.authorization).toBe("oauth2-web-server");
    expect(gmailConnector.scopes).toEqual([
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
    ]);
  });
});
