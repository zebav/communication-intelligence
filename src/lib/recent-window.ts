const DAY_IN_MS = 24 * 60 * 60 * 1000;

export function recentWindowStartIso(days: number, now = new Date()) {
  if (!Number.isFinite(days) || days <= 0) throw new Error("days must be a positive number");
  return new Date(now.getTime() - days * DAY_IN_MS).toISOString();
}
