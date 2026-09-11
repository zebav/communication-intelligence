import { createHmac, timingSafeEqual } from "node:crypto";
import { instagramConnector } from "./instagram";
import { normalizeCommunicationMessage } from "./normalization";

type InstagramAttachment = { type?: string; payload?: { url?: string } };
type InstagramMessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: InstagramAttachment[] };
};

type InstagramWebhookPayload = {
  object?: string;
  entry?: Array<{ id?: string; messaging?: InstagramMessagingEvent[] }>;
};

export type InstagramWebhookMessage = {
  accountId: string;
  participantId: string;
  message: ReturnType<typeof normalizeCommunicationMessage>;
};

export function validInstagramWebhookSignature(rawBody: string, signature: string | null, appSecret: string) {
  if (!signature?.startsWith("sha256=") || !appSecret) return false;
  const supplied = Buffer.from(signature.slice(7), "hex");
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody).digest("hex"), "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function parseInstagramWebhook(rawBody: string): InstagramWebhookMessage[] {
  let payload: InstagramWebhookPayload;
  try { payload = JSON.parse(rawBody) as InstagramWebhookPayload; } catch { return []; }
  if (payload.object !== "instagram" || !Array.isArray(payload.entry)) return [];
  return payload.entry.flatMap((entry) => (entry.messaging ?? []).flatMap((event) => {
    const accountId = entry.id?.trim();
    const senderId = event.sender?.id?.trim();
    const recipientId = event.recipient?.id?.trim();
    const externalId = event.message?.mid?.trim();
    if (!accountId || !senderId || !recipientId || !externalId) return [];
    const direction = event.message?.is_echo || senderId === accountId ? "out" as const : "in" as const;
    const participantId = direction === "out" ? recipientId : senderId;
    if (!participantId || participantId === accountId) return [];
    const text = event.message?.text?.trim() ?? "";
    const attachments = Array.isArray(event.message?.attachments) ? event.message.attachments : [];
    if (!text && !attachments.length) return [];
    return [{
      accountId,
      participantId,
      message: normalizeCommunicationMessage(instagramConnector, {
        externalId,
        externalConversationId: participantId,
        direction,
        senderIdentifier: senderId,
        body: text || `[${attachments.length} Instagram attachment${attachments.length === 1 ? "" : "s"}]`,
        sentAt: event.timestamp ? new Date(event.timestamp).toISOString() : undefined,
        attachmentCount: attachments.length,
        metadata: { instagram_account_id: accountId, instagram_participant_id: participantId, is_echo: Boolean(event.message?.is_echo), attachment_types: attachments.map((attachment) => attachment.type ?? "unknown").slice(0, 10), media_analysis_status: attachments.length ? "pending" : "not_applicable" },
      }),
    }];
  }));
}
