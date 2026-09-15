import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { normalizeCommunicationMessage } from "./normalization";
import { whatsappConnector } from "./whatsapp";
import type { WhatsAppWebhookMessage } from "./whatsapp-webhook";

export function validYCloudSignature(body: string, header: string | null, secret: string, now = Date.now()) {
  if (!header || !secret) return false;
  const fields = header.split(",").map((part) => part.trim());
  const timestamps = fields.filter((part) => part.startsWith("t="));
  const signatures = fields.filter((part) => part.startsWith("s="));
  if (timestamps.length !== 1 || signatures.length !== 1) return false;
  const timestamp = timestamps[0].slice(2), signature = signatures[0].slice(2);
  if (!/^\d+$/.test(timestamp) || !/^[a-fA-F0-9]{64}$/.test(signature) || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
const phone = z.string().regex(/^\+?[1-9]\d{6,14}$/);
const message = z.object({
  wamid: z.string().min(1), wabaId: z.string().regex(/^\d+$/),
  from: phone, to: phone, sendTime: z.string().datetime({ offset: true }), type: z.string().min(1),
  customerProfile: z.object({ name: z.string().optional() }).optional(),
  text: z.object({ body: z.string() }).optional(),
  image: z.object({ caption: z.string().optional() }).optional(),
  video: z.object({ caption: z.string().optional() }).optional(),
  document: z.object({ caption: z.string().optional() }).optional(),
});
const envelope = z.object({ id: z.string().min(1), type: z.string(), whatsappInboundMessage: z.unknown().optional(), whatsappMessage: z.unknown().optional() });
export function parseYCloudEvent(raw: string) {
  const event = envelope.parse(JSON.parse(raw));
  if (!["whatsapp.inbound_message.received", "whatsapp.smb.message.echoes"].includes(event.type)) return null;
  const direction = event.type === "whatsapp.inbound_message.received" ? "in" as const : "out" as const;
  const value = message.parse(direction === "in" ? event.whatsappInboundMessage : event.whatsappMessage);
  return { eventId: event.id, direction, value, businessPhone: (direction === "in" ? value.to : value.from).replace(/^\+/, "") };
}
export function ycloudMessage(event: NonNullable<ReturnType<typeof parseYCloudEvent>>, phoneNumberId: string): WhatsAppWebhookMessage {
  const { value, direction } = event;
  const participantId = (direction === "in" ? value.from : value.to).replace(/^\+/, "");
  const body = value.type === "text" ? value.text?.body ?? "" : value.image?.caption || value.video?.caption || value.document?.caption || `[WhatsApp ${value.type}]`;
  if (!body.trim()) throw new Error("empty_message");
  return { businessAccountId: value.wabaId, phoneNumberId, participantId, participantName: value.customerProfile?.name,
    message: normalizeCommunicationMessage(whatsappConnector, { externalId: value.wamid, externalConversationId: participantId, direction, senderIdentifier: direction === "in" ? participantId : event.businessPhone, body, sentAt: value.sendTime, attachmentCount: value.type === "text" ? 0 : 1, metadata: { provider: "ycloud", ycloud_event_id: event.eventId, whatsapp_business_account_id: value.wabaId, whatsapp_phone_number_id: phoneNumberId, whatsapp_message_type: value.type } }) };
}
