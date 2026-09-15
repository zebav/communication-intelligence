export function sentStatus(metadata: Record<string, unknown>, sentAt: string, lastIncomingAt?: string | null) {
  const delivery = String(metadata.delivery_status ?? "sent");
  const status = ["failed", "pending", "sent", "delivered", "read"].includes(delivery) ? delivery : "sent";
  const reply = lastIncomingAt && Date.parse(lastIncomingAt) > Date.parse(sentAt) ? "received" : metadata.expects_reply === true ? "waiting" : metadata.expects_reply === false ? "not_required" : "unknown";
  return { status, reply };
}
