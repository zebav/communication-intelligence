export type Source = "email" | "instagram" | "whatsapp" | "messenger" | "tinder" | "tiktok" | "linkedin" | "manual";
export type RecommendedAction = "RESPOND_NOW" | "RESPOND_TODAY" | "RESPOND_LATER" | "QUICK_REPLY" | "RESEARCH_FIRST" | "DECISION_REQUIRED" | "FOLLOW_UP" | "WAIT" | "IGNORE" | "ARCHIVE" | "UNSUBSCRIBE" | "UNSUBSCRIBE_AND_DELETE" | "END_CONVERSATION" | "SPAM" | "MANUAL_REVIEW";

export interface ScoreDimension { label: string; value: number; reason: string }
export interface AttentionAnalysis { score: number; dimensions: ScoreDimension[] }
export interface Person { id: string; name: string; initials: string; role: string; organization?: string; priority: "high" | "normal" | "low"; sources: Source[]; lastContact: string; summary: string }
export interface Message { id: string; direction: "in" | "out"; body: string; timestamp: string; source: Source }
export interface Conversation { id: string; person: Person; subject: string; preview: string; timestamp: string; unread: boolean; messages: Message[]; attention: AttentionAnalysis; action: RecommendedAction; actionReason: string; draft?: string; openLoop?: string }

export interface CommunicationCase {
  id: string;
  personName: string;
  title: string;
  source: Source;
  message: string;
  createdAt: string;
}

export interface SyncedEmailConversation {
  id: string;
  personName: string;
  title: string;
  preview: string;
  receivedAt: string;
  classification: string;
  priorityScore: number;
  recommendedAction: string;
  unread: boolean;
}

export function calculateAttention(dimensions: ScoreDimension[]): number {
  const total = 5 + dimensions.reduce((sum, item) => sum + item.value, 0);
  return Math.round(Math.min(10, Math.max(1, total)) * 10) / 10;
}

export function recommendAction(score: number, hasDecision = false, canQuickReply = false): RecommendedAction {
  if (hasDecision) return "DECISION_REQUIRED";
  if (score >= 8.5) return "RESPOND_NOW";
  if (canQuickReply && score >= 5.5) return "QUICK_REPLY";
  if (score >= 7) return "RESPOND_TODAY";
  if (score >= 4.5) return "RESPOND_LATER";
  return "IGNORE";
}

export const actionLabels: Record<RecommendedAction, string> = {
  RESPOND_NOW: "Respond now", RESPOND_TODAY: "Respond today", RESPOND_LATER: "Respond later", QUICK_REPLY: "Quick reply", RESEARCH_FIRST: "Research first", DECISION_REQUIRED: "Decision required", FOLLOW_UP: "Follow up", WAIT: "Wait", IGNORE: "Can ignore", ARCHIVE: "Archive", UNSUBSCRIBE: "Unsubscribe", UNSUBSCRIBE_AND_DELETE: "Unsubscribe + delete", END_CONVERSATION: "End conversation", SPAM: "Spam", MANUAL_REVIEW: "Manual review",
};
