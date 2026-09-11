import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { findWhatsAppWebhookConnection, parseWhatsAppWebhook, validWhatsAppWebhookSignature } from "./whatsapp-webhook";

const payload = { object: "whatsapp_business_account", entry: [{ id: "waba-1", changes: [{ field: "messages", value: { metadata: { display_phone_number: "+46 70 123", phone_number_id: "100" }, contacts: [{ wa_id: "4670999", profile: { name: "Anna Andersson" } }], messages: [{ from: "4670999", id: "wamid.1", timestamp: "1700000000", type: "text", text: { body: "Hej!" } }], statuses: [{ id: "wamid.out", status: "delivered", timestamp: "1700000001", recipient_id: "4670999" }] } }] }] };

describe("WhatsApp webhook", () => {
  it("verifies Meta signatures", () => {
    const body = JSON.stringify(payload);
    const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(validWhatsAppWebhookSignature(body, signature, "secret")).toBe(true);
    expect(validWhatsAppWebhookSignature(body, signature, "wrong")).toBe(false);
  });
  it("normalizes messages, names and status updates", () => {
    const parsed = parseWhatsAppWebhook(JSON.stringify(payload));
    expect(parsed.messages[0]).toMatchObject({ businessAccountId: "waba-1", phoneNumberId: "100", participantId: "4670999", participantName: "Anna Andersson", message: { source: "whatsapp", direction: "in", externalId: "wamid.1", body: "Hej!" } });
    expect(parsed.statuses[0]).toMatchObject({ externalMessageId: "wamid.out", status: "delivered" });
  });
  it("represents media without storing temporary media payloads", () => {
    const media = structuredClone(payload); const value = media.entry[0].changes[0].value; value.statuses = [];
    value.messages = [{ from: "4670999", id: "wamid.image", timestamp: "1700000000", type: "image", image: { id: "secret-media" } } as never];
    const parsed = parseWhatsAppWebhook(JSON.stringify(media));
    expect(parsed.messages[0]?.message).toMatchObject({ body: "[WhatsApp image]", attachmentCount: 1 });
    expect(JSON.stringify(parsed)).not.toContain("secret-media");
  });
  it("ignores malformed payloads and matches the exact phone-number connection", () => {
    expect(parseWhatsAppWebhook("bad")).toEqual({ messages: [], statuses: [] });
    const connections = [{ id: "a", token_metadata: { phone_number_id: "100" } }, { id: "b", token_metadata: { phone_number_id: "200" } }];
    expect(findWhatsAppWebhookConnection(connections, "200")?.id).toBe("b");
    expect(findWhatsAppWebhookConnection(connections, "300")).toBeUndefined();
  });
});
