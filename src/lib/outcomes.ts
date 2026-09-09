export type OutcomeStatus = "waiting" | "reply_received" | "resolved" | "follow_up_needed" | "unknown";

export function responseTimeMinutes(sentAt: string, receivedAt: string) {
  const difference = new Date(receivedAt).getTime() - new Date(sentAt).getTime();
  return Number.isFinite(difference) && difference >= 0 ? Math.round(difference / 60_000) : null;
}

export function outcomeAgeDays(createdAt: string, now = new Date()) {
  return Math.max(0, Math.floor((now.getTime() - new Date(createdAt).getTime()) / 86_400_000));
}

export function formatResponseTime(minutes?: number | null) {
  if (minutes == null) return "Not available";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} hr`;
  return `${Math.round(minutes / 1440)} days`;
}

export function positiveOutcomeRule(input: { personName: string; relationship?: string | null; replyWordCount: number }) {
  const scope = input.relationship && input.relationship !== "unknown" ? `${input.relationship} conversations` : `conversations with ${input.personName}`;
  return `A reply of about ${input.replyWordCount} words was followed by an outcome you marked successful. Consider a similar level of detail in comparable ${scope}, while adapting to the current facts.`;
}
