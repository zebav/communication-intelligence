import { calculateAttention, type Conversation, type Person, type ScoreDimension } from "./domain";

export const people: Person[] = [
  { id: "p1", name: "Maya Chen", initials: "MC", role: "Founder", organization: "Northstar Labs", priority: "high", sources: ["email", "linkedin"], lastContact: "12 min ago", summary: "Strategic partner. Direct, warm, and values concise decisions." },
  { id: "p2", name: "Daniel Ekström", initials: "DE", role: "Product lead", organization: "Halo", priority: "high", sources: ["whatsapp", "email"], lastContact: "38 min ago", summary: "Long-running product collaboration with strong reciprocity." },
  { id: "p3", name: "Sofia Lind", initials: "SL", role: "Friend", priority: "normal", sources: ["instagram", "whatsapp"], lastContact: "2 h ago", summary: "Close friend. Prefers relaxed, playful messages." },
  { id: "p4", name: "Oskar Nilsson", initials: "ON", role: "Account executive", organization: "Metricly", priority: "low", sources: ["email"], lastContact: "Yesterday", summary: "Cold sales contact with low current relevance." },
];

function analysis(dimensions: ScoreDimension[]) { return { dimensions, score: calculateAttention(dimensions) }; }

export const conversations: Conversation[] = [
  { id: "c1", person: people[0], subject: "Partnership decision", preview: "If we can confirm today, I can reserve the launch slot…", timestamp: "12m", unread: true, attention: analysis([
    { label: "Relationship", value: 1.4, reason: "High-priority strategic relationship" }, { label: "Urgency", value: 1.3, reason: "Launch slot expires today" }, { label: "Opportunity", value: 1.2, reason: "Meaningful partnership upside" }, { label: "Effort", value: -0.2, reason: "Requires a clear commercial decision" },
  ]), action: "DECISION_REQUIRED", actionReason: "A time-sensitive commercial choice is blocking progress.", openLoop: "Confirm the September launch slot today", draft: "Hi Maya — the September slot works for me. Please reserve it, and send over the final scope so I can confirm the remaining details today.", messages: [
    { id: "m1", direction: "out", body: "The pilot results look strong. September could work if the scope stays focused.", timestamp: "Yesterday, 16:42", source: "email" },
    { id: "m2", direction: "in", body: "Agreed. I can keep the scope to the two workflows we discussed. If we can confirm today, I can reserve the September launch slot before our planning meeting tomorrow.", timestamp: "Today, 14:18", source: "email" },
  ] },
  { id: "c2", person: people[1], subject: "Prototype review", preview: "The new prioritization flow is much clearer…", timestamp: "38m", unread: true, attention: analysis([
    { label: "Relevance", value: 1.2, reason: "Directly related to active product work" }, { label: "Momentum", value: 0.9, reason: "Active collaboration" }, { label: "Reciprocity", value: 0.6, reason: "Consistently responsive" },
  ]), action: "RESPOND_TODAY", actionReason: "High-value active work; a response maintains momentum.", messages: [{ id: "m3", direction: "in", body: "The new prioritization flow is much clearer. I left two comments on the cleanup screen, but otherwise this feels ready for the next review.", timestamp: "Today, 13:52", source: "whatsapp" }] },
  { id: "c3", person: people[2], subject: "Dinner Friday", preview: "Still up for dinner on Friday?", timestamp: "2h", unread: true, attention: analysis([
    { label: "Relationship", value: 1.1, reason: "Important personal relationship" }, { label: "Effort", value: -0.4, reason: "Easy confirmation" }, { label: "Urgency", value: 0.3, reason: "Plans need confirmation" },
  ]), action: "QUICK_REPLY", actionReason: "A short confirmation is enough.", draft: "Absolutely — Friday works. 19:00 at the place we talked about?", openLoop: "Confirm Friday dinner", messages: [{ id: "m4", direction: "in", body: "Still up for dinner on Friday? I can book that little place in Vasastan 🙂", timestamp: "Today, 12:26", source: "instagram" }] },
  { id: "c4", person: people[3], subject: "Quick intro to Metricly", preview: "Would you have 20 minutes next week?", timestamp: "1d", unread: false, attention: analysis([
    { label: "Relevance", value: -1.2, reason: "No current need for this product" }, { label: "Spam probability", value: -1, reason: "Unsolicited sales sequence" }, { label: "Effort", value: -0.3, reason: "Meeting request creates work" },
  ]), action: "IGNORE", actionReason: "Low relevance and no established relationship.", messages: [{ id: "m5", direction: "in", body: "I noticed your work in communication tooling and thought Metricly might help. Would you have 20 minutes next week?", timestamp: "Yesterday, 09:13", source: "email" }] },
];

export const followUps = [
  { person: "Maya Chen", text: "Confirm September launch slot", due: "Today", owner: "I owe them", tone: "urgent" },
  { person: "Sofia Lind", text: "Confirm Friday dinner", due: "Today", owner: "I owe them", tone: "normal" },
  { person: "Daniel Ekström", text: "Send prototype notes", due: "Tomorrow", owner: "They owe me", tone: "normal" },
];

export const cleanups = [
  { sender: "Growth Weekly", count: 12, reason: "Unread for 11 weeks", action: "Unsubscribe" },
  { sender: "Product Hunt", count: 9, reason: "Mostly archived without reading", action: "Review" },
  { sender: "Metricly Sales", count: 4, reason: "Unsolicited sequence", action: "Unsubscribe" },
];
