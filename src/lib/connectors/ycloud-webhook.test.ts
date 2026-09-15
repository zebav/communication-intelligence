import { createHmac } from "node:crypto";
import { expect, it } from "vitest";
import { parseYCloudEvent, validYCloudSignature, ycloudMessage } from "./ycloud-webhook";
const value = { wamid: "wamid.example", wabaId: "123", from: "+46701234567", to: "+46707654321", sendTime: "2026-09-15T10:00:00Z", type: "text", text: { body: "Hej!" } };
it("verifies the exact raw body and rejects forged, stale and malformed signatures", () => {
 const body = JSON.stringify({ x: 1 }), t = 1789466400;
 const header = `t=${t},s=${createHmac("sha256", "secret").update(`${t}.${body}`).digest("hex")}`;
 expect(validYCloudSignature(body, header, "secret", t * 1000)).toBe(true);
 expect(validYCloudSignature(body + " ", header, "secret", t * 1000)).toBe(false);
 expect(validYCloudSignature(body, header, "secret", (t + 301) * 1000)).toBe(false);
 expect(validYCloudSignature(body, `t=${t},s=invalid`, "secret", t * 1000)).toBe(false);
 expect(validYCloudSignature(body, header + `,t=${t}`, "secret", t * 1000)).toBe(false);
});
it("maps inbound messages to the sender and business recipient", () => {
 const event = parseYCloudEvent(JSON.stringify({ id: "event", type: "whatsapp.inbound_message.received", whatsappInboundMessage: value }))!;
 expect(event.businessPhone).toBe("46707654321");
 expect(ycloudMessage(event, "456")).toMatchObject({ participantId: "46701234567", phoneNumberId: "456", message: { externalId: "wamid.example", direction: "in", body: "Hej!" } });
});
it("maps mobile echoes as outgoing to the other person", () => {
 const event = parseYCloudEvent(JSON.stringify({ id: "event", type: "whatsapp.smb.message.echoes", whatsappMessage: value }))!;
 expect(event.businessPhone).toBe("46701234567");
 expect(ycloudMessage(event, "456")).toMatchObject({ participantId: "46707654321", message: { direction: "out" } });
});
it("rejects incomplete known events instead of silently acknowledging them", () => {
 expect(() => parseYCloudEvent(JSON.stringify({ id: "event", type: "whatsapp.inbound_message.received", whatsappInboundMessage: { ...value, sendTime: "bad" } }))).toThrow();
 expect(parseYCloudEvent(JSON.stringify({ id: "event", type: "unsubscribed.event" }))).toBeNull();
});
