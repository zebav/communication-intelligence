import type { CommunicationCase, SyncedEmailConversation } from "./domain";

type DecisionState = { status: string } | undefined;

export type TodayBucket = "action" | "note" | "preparing" | "hidden";

const replyActions = new Set(["RESPOND_NOW", "RESPOND_TODAY", "RESPOND_LATER", "QUICK_REPLY", "RESEARCH_FIRST", "DECISION_REQUIRED", "FOLLOW_UP"]);
const bulkClassifications = new Set(["Marketing", "Newsletter", "Spam", "Notification", "Information Only", "Receipt / Invoice"]);
const actionDecisionStates = new Set(["decision", "ready"]);

// This deliberately mirrors the server-side decision gate's conservative
// treatment of campaigns and automated forum traffic. It is kept dependency
// free because Today runs in the browser too; the saved AI analysis remains
// the authority for a reply recommendation.
const promotionalOrForumText = /\b(nyhetsbrev|newsletter|unsubscribe|avregistrera|kampanj|erbjudande|offer|rabatt|% off|member benefits|shop now|sale|rea|casino|betting|crypto giveaway|telegram group|onion|new (?:forum |community )?(?:post|topic|reply)|reply to (?:this )?(?:topic|thread)|community digest|forum digest)\b/i;
const importantServiceText = /\b(kivra|distrokid|testflight|app store connect|apple developer|bankid|skatteverket|verksamt|bolagsverket|microsoft 365|google workspace|cloudflare|domain renewal|renewal notice|utbetalning|payout|royalt(?:y|ies)|tax|moms|invoice overdue|förfallen faktura)\b/i;
const concreteObligationText = /\b(action required|please reply|please review|can you|could you|svara senast|återkom|kan du|kan ni|deadline|förfaller|due date)\b/i;

function textOf(item: Pick<SyncedEmailConversation, "title" | "preview" | "personName"> | Pick<CommunicationCase, "title" | "message" | "personName">) {
  return "preview" in item
    ? `${item.title}\n${item.preview}\n${item.personName}`
    : `${item.title}\n${item.message}\n${item.personName}`;
}

function isExplicitlyDeprioritized(item: Pick<SyncedEmailConversation, "handlingRule">) {
  return item.handlingRule === "low_priority";
}

function isPromotionalOrForum(item: Pick<SyncedEmailConversation, "title" | "preview" | "personName" | "classification">) {
  const text = textOf(item);
  return !importantServiceText.test(text) && (bulkClassifications.has(item.classification) || promotionalOrForumText.test(text));
}

function isImportantNotice(item: Pick<SyncedEmailConversation, "title" | "preview" | "personName" | "classification" | "priorityScore" | "manualPriority" | "handlingRule">) {
  const text = textOf(item);
  if (isPromotionalOrForum(item) || isExplicitlyDeprioritized(item)) return false;
  if (importantServiceText.test(text)) return true;
  if (["Critical", "Legal", "Financial", "Booking / Travel"].includes(item.classification)) return true;
  return item.handlingRule === "always_priority" || (item.manualPriority ?? 0) >= 8 || item.priorityScore >= 8;
}

function isActionableEmail(item: SyncedEmailConversation, decision: DecisionState) {
  if (decision && actionDecisionStates.has(decision.status)) return true;
  if (isPromotionalOrForum(item) || isExplicitlyDeprioritized(item)) return false;
  if (item.analysis?.requiresReply) return true;
  // Before an older imported message has been through the current analysis
  // version, only an explicit request with a meaningful priority may enter
  // the decision group. A generic Business classification is not enough.
  return item.classification === "Action Required"
    && replyActions.has(item.recommendedAction)
    && item.priorityScore >= 7
    && concreteObligationText.test(textOf(item));
}

export function selectTodayEmail(item: SyncedEmailConversation, decision?: DecisionState): TodayBucket {
  if (isPromotionalOrForum(item)) return "hidden";
  if (isActionableEmail(item, decision)) return "action";
  return isImportantNotice(item) ? "note" : "hidden";
}

export function selectTodayChannel(item: CommunicationCase, decision?: DecisionState): TodayBucket {
  const latestInbound = item.threadMessages?.filter((message) => message.direction === "in").at(-1);
  if (!latestInbound || item.conversationType === "imported") return "hidden";
  const text = textOf(item);
  if (promotionalOrForumText.test(text)) return "hidden";
  if (decision && actionDecisionStates.has(decision.status)) return "action";
  if (item.analysis?.requiresReply) return "action";
  if (item.analysis && (item.priorityScore ?? 0) >= 7) return "note";
  // A meaningful direct-channel message without an analysis has not yet been
  // classified. Show a single preparation card rather than silently losing it
  // or incorrectly demanding an immediate reply.
  return (item.priorityScore ?? 0) >= 5 ? "preparing" : "hidden";
}
