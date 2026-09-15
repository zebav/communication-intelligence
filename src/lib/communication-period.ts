export type CommunicationPeriod = "today" | "yesterday" | "7days" | "30days";

export const communicationPeriods: Array<{ id: CommunicationPeriod; label: string }> = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7days", label: "Last 7 days" },
  { id: "30days", label: "Last 30 days" },
];

function startOfLocalDay(value: Date) {
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
}

export function isWithinCommunicationPeriod(timestamp: string, period: CommunicationPeriod, now = new Date()) {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return false;
  const today = startOfLocalDay(now);
  const messageDay = startOfLocalDay(value);
  const oneDay = 24 * 60 * 60 * 1000;
  if (period === "today") return messageDay === today;
  if (period === "yesterday") return messageDay === today - oneDay;
  const days = period === "7days" ? 7 : 30;
  return messageDay >= today - (days - 1) * oneDay && messageDay <= now.getTime();
}
