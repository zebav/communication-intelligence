import type { SyncedEmailConversation } from "./domain";

const categoryOrder: Record<string, number> = {
  Critical: 0,
  "Action Required": 1,
  Legal: 2,
  Financial: 3,
  Customer: 4,
  Business: 5,
  Personal: 6,
  "Booking / Travel": 7,
  "Receipt / Invoice": 8,
  "Information Only": 9,
  Notification: 10,
  Newsletter: 11,
  Marketing: 12,
  Spam: 13,
};

export function prioritizeEmails(emails: SyncedEmailConversation[]) {
  return [...emails].sort((left, right) => {
    const categoryDifference = (categoryOrder[left.classification] ?? 99) - (categoryOrder[right.classification] ?? 99);
    if (categoryDifference !== 0) return categoryDifference;
    if (right.priorityScore !== left.priorityScore) return right.priorityScore - left.priorityScore;
    return new Date(right.receivedAt).getTime() - new Date(left.receivedAt).getTime();
  });
}

export function emailDashboardSummary(emails: SyncedEmailConversation[]) {
  return {
    total: emails.length,
    unread: emails.filter((email) => email.unread).length,
    critical: emails.filter((email) => email.classification === "Critical").length,
    needsResponse: emails.filter((email) => ["RESPOND_NOW", "RESPOND_TODAY", "RESPOND_LATER"].includes(email.recommendedAction)).length,
    lowAttention: emails.filter((email) => email.priorityScore < 4).length,
  };
}
