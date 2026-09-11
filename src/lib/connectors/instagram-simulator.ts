import { createHmac } from "node:crypto";

export type SimulatedInstagramMessage = { accountId: string; participantId: string; messageId: string; text?: string; direction?: "in" | "out"; attachmentType?: "image" | "audio" | "video" | "file"; timestamp?: number };

export function simulatedInstagramWebhook(input: SimulatedInstagramMessage) {
  const outgoing = input.direction === "out";
  const sender = outgoing ? input.accountId : input.participantId;
  const recipient = outgoing ? input.participantId : input.accountId;
  return JSON.stringify({ object: "instagram", entry: [{ id: input.accountId, time: input.timestamp ?? Date.now(), messaging: [{ sender: { id: sender }, recipient: { id: recipient }, timestamp: input.timestamp ?? Date.now(), message: { mid: input.messageId, text: input.text, is_echo: outgoing || undefined, attachments: input.attachmentType ? [{ type: input.attachmentType, payload: { url: "https://temporary.invalid/media" } }] : undefined } }] }] });
}

export function signSimulatedInstagramWebhook(body: string, appSecret: string) {
  return `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`;
}

export function uniqueSimulatedDeliveries(bodies: string[]) {
  const seen = new Set<string>();
  return bodies.filter((body) => { const parsed = JSON.parse(body) as { entry?: Array<{ messaging?: Array<{ message?: { mid?: string } }> }> }; const id = parsed.entry?.[0]?.messaging?.[0]?.message?.mid; if (!id || seen.has(id)) return false; seen.add(id); return true; });
}
