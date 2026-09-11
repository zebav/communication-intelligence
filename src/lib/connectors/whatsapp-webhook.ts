import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeCommunicationMessage } from "./normalization";
import { whatsappConnector } from "./whatsapp";

type WhatsAppMessage = { id?: string; from?: string; timestamp?: string; type?: string; text?: { body?: string }; image?: unknown; audio?: unknown; video?: unknown; document?: unknown; sticker?: unknown; location?: unknown; contacts?: unknown; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } } };
type WhatsAppValue = { metadata?: { display_phone_number?: string; phone_number_id?: string }; contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>; messages?: WhatsAppMessage[]; statuses?: Array<{ id?: string; status?: string; timestamp?: string; recipient_id?: string; errors?: unknown }> };
type WhatsAppPayload = { object?: string; entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: WhatsAppValue }> }> };

export type WhatsAppWebhookMessage = {
  businessAccountId: string;
  phoneNumberId: string;
  displayPhoneNumber?: string;
  participantId: string;
  participantName?: string;
  message: ReturnType<typeof normalizeCommunicationMessage>;
};

export type WhatsAppStatusUpdate = { phoneNumberId: string; externalMessageId: string; status: string; timestamp?: string; recipientId?: string; errors?: unknown };

export function validWhatsAppWebhookSignature(rawBody: string, signature: string | null, appSecret: string) {
  if (!signature?.startsWith("sha256=") || !appSecret) return false;
  const supplied = Buffer.from(signature.slice(7), "hex");
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody).digest("hex"), "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function messageBody(message: WhatsAppMessage) {
  if (message.type === "text") return message.text?.body?.trim() ?? "";
  if (message.type === "interactive") return message.interactive?.button_reply?.title?.trim() || message.interactive?.list_reply?.title?.trim() || "[WhatsApp interactive reply]";
  const supportedAttachment = ["image", "audio", "video", "document", "sticker", "location", "contacts"].find((type) => message[type as keyof WhatsAppMessage]);
  return supportedAttachment ? `[WhatsApp ${supportedAttachment}]` : message.type ? `[WhatsApp ${message.type}]` : "";
}

export function parseWhatsAppWebhook(rawBody: string): { messages: WhatsAppWebhookMessage[]; statuses: WhatsAppStatusUpdate[] } {
  let payload: WhatsAppPayload;
  try { payload = JSON.parse(rawBody) as WhatsAppPayload; } catch { return { messages: [], statuses: [] }; }
  if (payload.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) return { messages: [], statuses: [] };
  const messages: WhatsAppWebhookMessage[] = [];
  const statuses: WhatsAppStatusUpdate[] = [];
  for (const entry of payload.entry) for (const change of entry.changes ?? []) {
    if (change.field !== "messages") continue;
    const value = change.value;
    const phoneNumberId = value?.metadata?.phone_number_id?.trim();
    if (!phoneNumberId) continue;
    const contactNames = new Map((value?.contacts ?? []).flatMap((contact) => contact.wa_id ? [[contact.wa_id, contact.profile?.name?.trim() || undefined] as const] : []));
    for (const item of value?.messages ?? []) {
      const externalId = item.id?.trim();
      const participantId = item.from?.trim();
      const body = messageBody(item);
      if (!externalId || !participantId || !body) continue;
      const attachmentCount = item.type && item.type !== "text" && item.type !== "interactive" ? 1 : 0;
      messages.push({ businessAccountId: entry.id ?? "", phoneNumberId, displayPhoneNumber: value?.metadata?.display_phone_number, participantId, participantName: contactNames.get(participantId), message: normalizeCommunicationMessage(whatsappConnector, { externalId, externalConversationId: participantId, direction: "in", senderIdentifier: participantId, senderName: contactNames.get(participantId), body, sentAt: item.timestamp ? new Date(Number(item.timestamp) * 1000).toISOString() : undefined, attachmentCount, metadata: { whatsapp_business_account_id: entry.id ?? null, whatsapp_phone_number_id: phoneNumberId, whatsapp_message_type: item.type ?? "unknown", media_analysis_status: attachmentCount ? "pending" : "not_applicable" } }) });
    }
    for (const item of value?.statuses ?? []) if (item.id && item.status) statuses.push({ phoneNumberId, externalMessageId: item.id, status: item.status, timestamp: item.timestamp ? new Date(Number(item.timestamp) * 1000).toISOString() : undefined, recipientId: item.recipient_id, errors: item.errors });
  }
  return { messages, statuses };
}

export type WhatsAppWebhookConnection = { token_metadata?: unknown };
export function findWhatsAppWebhookConnection<T extends WhatsAppWebhookConnection>(connections: T[], phoneNumberId: string) {
  return connections.find((connection) => {
    const metadata = connection.token_metadata && typeof connection.token_metadata === "object" && !Array.isArray(connection.token_metadata) ? connection.token_metadata as Record<string, unknown> : {};
    return String(metadata.phone_number_id ?? "") === phoneNumberId;
  });
}
