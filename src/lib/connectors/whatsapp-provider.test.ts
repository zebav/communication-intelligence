import { describe, expect, it } from "vitest";
import { activeWhatsAppProvider, inactiveProviderResponse } from "./whatsapp-provider";

describe("provider-neutral WhatsApp routing", () => {
  it("uses YCloud automatically when its signed webhook is configured", () => {
    expect(activeWhatsAppProvider({ YCLOUD_WEBHOOK_SECRET: "configured" })).toBe("ycloud");
  });

  it("supports an explicit future switch to Meta Direct", () => {
    expect(activeWhatsAppProvider({ WHATSAPP_ACTIVE_PROVIDER: "meta-direct", YCLOUD_WEBHOOK_SECRET: "configured" })).toBe("meta-direct");
  });

  it("acknowledges an authenticated inactive provider without importing it", () => {
    expect(inactiveProviderResponse("meta-direct", "ycloud")).toEqual({ received: true, ignored: true, provider: "meta-direct", activeProvider: "ycloud", reason: "inactive_provider" });
  });
});
