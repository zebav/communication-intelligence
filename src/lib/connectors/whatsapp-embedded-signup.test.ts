import { describe, expect, it } from "vitest";
import { parseWhatsAppEmbeddedSignupEvent, whatsappTokenExchangeUrl } from "./whatsapp-embedded-signup";

describe("WhatsApp Embedded Signup", () => {
  it("reads a completed coexistence session", () => {
    expect(parseWhatsAppEmbeddedSignupEvent({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { waba_id: "123", phone_number_id: "456" } })).toEqual({ businessAccountId: "123", phoneNumberId: "456" });
  });
  it("accepts Meta's JSON-string message and rejects incomplete events", () => {
    expect(parseWhatsAppEmbeddedSignupEvent(JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { waba_id: "123", phone_number_id: "456" } }))).not.toBeNull();
    expect(parseWhatsAppEmbeddedSignupEvent({ type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: {} })).toBeNull();
  });
  it("builds the server-side code exchange URL", () => {
    const url = whatsappTokenExchangeUrl({ appId: "1", appSecret: "secret", code: "code", version: "v26.0" });
    expect(url.origin + url.pathname).toBe("https://graph.facebook.com/v26.0/oauth/access_token");
    expect(url.searchParams.get("client_secret")).toBe("secret");
  });
});
