import { describe, expect, it } from "vitest";
import { whatsappCallbackUrl } from "./whatsapp-callback";
describe("WhatsApp callback destination", () => {
  it("keeps production delivery when diagnostics run in a preview", () => {
    expect(whatsappCallbackUrl("https://temporary-preview.vercel.app", { VERCEL_PROJECT_PRODUCTION_URL: "production.vercel.app" })).toBe("https://production.vercel.app/api/connectors/whatsapp/webhook");
  });
  it("respects an explicitly configured receiving deployment", () => {
    expect(whatsappCallbackUrl("https://preview.example", { WHATSAPP_WEBHOOK_URL: "https://receiver.example/api/connectors/whatsapp/webhook", VERCEL_PROJECT_PRODUCTION_URL: "production.example" })).toBe("https://receiver.example/api/connectors/whatsapp/webhook");
  });
  it("does not construct insecure or credential-bearing callbacks", () => {
    expect(() => whatsappCallbackUrl("http://example.com", {})).toThrow();
    expect(() => whatsappCallbackUrl("https://example.com", { WHATSAPP_WEBHOOK_URL: "https://user:password@example.com/webhook" })).toThrow();
  });
});
