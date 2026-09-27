import { describe, expect, it } from "vitest";
import { ephemeralMetaWhatsAppMediaIds } from "./whatsapp-media";

describe("ephemeral Meta WhatsApp media", () => {
  it("extracts a provider media id without putting it in stored message metadata", () => {
    const result = ephemeralMetaWhatsAppMediaIds(JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { messages: [{ id: "wamid.1", image: { id: "123456" } }] } }] }] }));
    expect(result.get("wamid.1")).toEqual(["123456"]);
  });
});
