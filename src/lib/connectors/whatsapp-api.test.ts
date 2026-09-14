import { describe, expect, it } from "vitest";
import { whatsappMessagesUrl, whatsappPhoneUrl, whatsappSendBody, whatsappSubscribedAppsUrl } from "./whatsapp-api";

describe("WhatsApp Cloud API", () => {
  it("builds versioned phone, message and webhook subscription endpoints", () => {
    expect(whatsappMessagesUrl("123", "v23.0")).toBe("https://graph.facebook.com/v23.0/123/messages");
    expect(whatsappPhoneUrl("123", "v23.0")).toContain("display_phone_number");
    expect(whatsappSubscribedAppsUrl("456", "v23.0")).toBe("https://graph.facebook.com/v23.0/456/subscribed_apps");
  });
  it("builds an approved text reply", () => expect(whatsappSendBody("46701234567", " Hej! ")).toEqual({ messaging_product: "whatsapp", recipient_type: "individual", to: "46701234567", type: "text", text: { preview_url: false, body: "Hej!" } }));
  it("rejects unsafe identifiers and empty messages", () => {
    expect(() => whatsappMessagesUrl("../me", "v23.0")).toThrow();
    expect(() => whatsappSubscribedAppsUrl("waba-1", "v23.0")).toThrow();
    expect(() => whatsappSendBody("+46 70", "Hej")).toThrow();
    expect(() => whatsappSendBody("4670", " ")).toThrow();
  });
});
