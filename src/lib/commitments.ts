export function normalizeCommitmentDueAt(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function followUpSection(item: { owner: "user" | "sender" | "unknown"; dueAt?: string; status: string }, now = new Date()) {
  if (item.status === "suggested") return "Review";
  if (item.dueAt && new Date(item.dueAt).getTime() < now.getTime()) return "Overdue";
  if (item.owner === "user") return "I owe them";
  if (item.owner === "sender") return "They owe me";
  return item.dueAt ? "Upcoming" : "Waiting";
}
