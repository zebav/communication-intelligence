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

export type CommunicationSituation = "business" | "conflict" | "followUp" | "personal" | "romantic" | "logistics" | "sensitive";
export interface ProfileGuidance { tone: string; guidance: string }
export interface PersonProfileGuidance extends ProfileGuidance { name: string }
export interface UniversalCommunicationProfile {
  identitySummary: string;
  values: string;
  defaultTone: string;
  preferredLength: string;
  principles: string;
  signOff: string;
  channels: Partial<Record<Source, ProfileGuidance>>;
  situations: Partial<Record<CommunicationSituation, ProfileGuidance>>;
  people: Record<string, PersonProfileGuidance>;
}
export interface CommunicationPersonOption { id: string; name: string; relationship: string; organization: string }

export interface SyncedEmailConversation {
  id: string;
  personId?: string;
  messageId: string;
  personName: string;
  title: string;
  preview: string;
  receivedAt: string;
  classification: string;
  priorityScore: number;
  recommendedAction: string;
  unread: boolean;
  relationshipType?: string;
  manualPriority?: number | null;
  handlingRule?: "normal" | "always_priority" | "low_priority";
  relevanceReasons?: string[];
  memories?: PersonMemory[];
  threadMessages: { id: string; direction: "in" | "out"; body: string; sentAt: string }[];
  analysis?: { confidence: number; summary: string; intent: string; priorityReason: string; requiresReply: boolean; draftResponse: string; draftTone: string; commitment?: { description: string; dueAt: string; owner: "user" | "sender" | "unknown"; confidence: number } };
  deepAnalysis?: DeepAnalysis;
}

export interface DeepAnalysis {
  createdAt: string;
  usedWebResearch: boolean;
  overview: string;
  stakes: string;
  facts: string[];
  inferences: { claim: string; basis: string; confidence: number }[];
  unknowns: string[];
  options: { label: string; benefits: string; risks: string }[];
  recommendedApproach: string;
  responseStrategy: string;
  suggestedReply: string;
  researchNeeded: boolean;
  researchQuestions: string[];
  sources: { title: string; url: string; supports: string }[];
}

export interface PersonMemory {
  id: string;
  category: "relationship" | "fact" | "preference" | "context";
  content: string;
  confidence: number;
  verified: boolean;
}

export interface FollowUpCommitment {
  id: string;
  conversationId: string;
  personName: string;
  conversationTitle: string;
  description: string;
  owner: "user" | "sender" | "unknown";
  dueAt?: string;
  status: "suggested" | "open" | "completed" | "dismissed";
  confidence: number;
}

export interface IntelligentPerson {
  id: string;
  name: string;
  organization: string;
  relationshipType: string;
  notes: string;
  relationshipSummary: string;
  manualPriority?: number;
  overallPriority?: number;
  firstContactAt?: string;
  lastContactAt?: string;
  identities: { id: string; source: Source; identifier: string; verified: boolean }[];
  memories: PersonMemory[];
  conversations: { id: string; title: string; source: Source; lastMessageAt?: string; summary: string }[];
  openLoops: number;
  responseRate?: number;
}

export interface LearningSignal {
  id: string;
  personName?: string;
  conversationTitle?: string;
  source: Source;
  signalType: "draft_accepted" | "draft_edited" | "tone_requested" | "category_corrected" | "outcome_confirmed";
  observation: string;
  proposedRule: string;
  confidence: number;
  status: "suggested" | "approved" | "dismissed";
  createdAt: string;
}

export interface CommunicationOutcome {
  id: string;
  personName: string;
  conversationTitle: string;
  desiredOutcome: string;
  status: "waiting" | "reply_received" | "resolved" | "follow_up_needed" | "unknown";
  ownerRating?: "successful" | "neutral" | "unsuccessful";
  responseTimeMinutes?: number;
  userConfirmed: boolean;
  createdAt: string;
  updatedAt: string;
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
