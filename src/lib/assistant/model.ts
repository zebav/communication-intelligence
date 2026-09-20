import { z } from "zod";
import type { EmailAnalysis } from "@/lib/ai/service";
import type { Source } from "@/lib/domain";

export const kinds = ["reply", "forward", "meeting", "follow_up", "website"] as const;
export const statuses = ["decision", "ready", "executing", "waiting", "done", "dismissed", "uncertain"] as const;
export type TaskKind = typeof kinds[number];
export type TaskStatus = typeof statuses[number];
export const kindLabels: Record<TaskKind, string> = { reply: "Svara", forward: "Ta hjälp av rådgivare", meeting: "Planera möte", follow_up: "Följ upp", website: "Uppgift på webben" };
export const statusLabels: Record<TaskStatus, string> = { decision: "Behöver ditt beslut", ready: "Redo att genomföra", executing: "Pågår", waiting: "Väntar på någon annan", done: "Hanterat", dismissed: "Avstått", uncertain: "Behöver kontrolleras" };
export type Evidence = {
  messageId: string; conversationId: string; personId: string | null; personName: string;
  source: Source; connectionId: string | null; provider: string; account: string;
  title: string; body: string; sentAt: string; direction: "in" | "out";
  lastUserAt: string | null; lastOtherAt: string | null; classification: string; priority: number;
  /** Read state affects ranking only. It can never create an action by itself. */
  unread?: boolean; analysis: Partial<EmailAnalysis>; recipient: string; version: string;
};
export type PreparedDecision = {
  status: "ready" | "needs_input" | "failed";
  summary: string;
  preparedAt: string;
  meeting?: {
    date: string;
    durationMinutes: number;
    location: string;
    placeName: string;
    placeAddress: string;
    travelSummary: string;
    slots: Array<{ start: string; end: string }>;
  };
  research?: {
    overview: string;
    recommendedApproach: string;
    sources: Array<{ title: string; url: string; supports: string }>;
  };
};

export type Plan = {
  evidence: Evidence; draft: string; originalDraft: string; reason: string;
  recipientPersonId: string | null; recipient: string; recipientName: string;
  followUpAt: string | null; steps: string[];
  preparation?: PreparedDecision;
};
export type Task = { id: string; message_id: string; kind: TaskKind; status: TaskStatus; revision: number; plan: Plan; result: Record<string, unknown>; created_at: string; updated_at: string; observedReplyAt?: string };
export type DecisionCard = {
  summary: string;
  whyImportant: string;
  proposedAction: string;
  approvalOutcome: string;
  targetUrl: string;
};

export function decisionCard(plan: Plan, kind: TaskKind): DecisionCard {
  const e = plan.evidence;
  const action = e.analysis.actionSuggestion;
  const summary = e.analysis.summary?.trim()
    || e.analysis.intent?.trim()
    || (e.body.length > 280 ? `${e.body.slice(0, 277).trim()}…` : e.body.trim())
    || e.title
    || "Uppgiften behöver granskas.";
  const whyImportant = plan.reason?.trim()
    || e.analysis.priorityReason?.trim()
    || `Prioritet ${Math.max(0, Math.min(10, e.priority || 0)).toFixed(1)}/10.`;
  const preparedMeeting = plan.preparation?.meeting;
  const proposedAction = kind === "reply" ? "Skicka det sparade svaret i samma konversation."
    : kind === "forward" ? `Vidarebefordra originalet med introduktionen till ${plan.recipientName || "vald rådgivare"}.`
    : kind === "follow_up" ? "Skicka den sparade uppföljningen en gång."
    : kind === "meeting" && preparedMeeting?.slots.length
      ? `Svara med de ${preparedMeeting.slots.length} kontrollerade tiderna${preparedMeeting.placeName ? ` och platsen ${preparedMeeting.placeName}` : ""}.`
      : kind === "meeting" ? "Förbered mötesalternativ från masterkalendern innan du svarar."
      : action?.task?.trim() || "Öppna den föreslagna webbuppgiften för säker granskning.";
  const approvalOutcome = kind === "reply" ? `Ett meddelande skickas en gång från ${e.account} till ${plan.recipientName || e.personName}. Därefter väntar uppdraget på svar.`
    : kind === "forward" ? `Originalmejlet och den sparade introduktionen skickas en gång från ${e.account} till ${plan.recipientName || "den verifierade rådgivaren"}.`
    : kind === "follow_up" ? `En uppföljning skickas en gång till ${plan.recipientName || e.personName}. Automatisk omsändning är spärrad.`
    : kind === "meeting" ? (plan.draft.trim()
      ? `Det färdiga svaret med de kontrollerade mötesalternativen skickas en gång till ${plan.recipientName || e.personName}. Ingen tid bokas i kalendern innan motparten har bekräftat ett alternativ.`
      : "Förbered uppdraget först så att kalender, plats och eventuella reseförutsättningar kan kontrolleras innan du tar beslut.")
    : "När du godkänner kör Browserbase den sparade webbuppgiften. Saknade privata uppgifter efterfrågas först och kan sparas krypterat. Betalningar, juridiska signeringar, säkerhetsändringar och destruktiva kontoåtgärder blockeras.";
  return { summary, whyImportant, proposedAction, approvalOutcome, targetUrl: action?.targetUrl?.trim() || "" };
}
export const editSchema = z.object({ draft: z.string().trim().max(4000), recipientPersonId: z.string().uuid().nullable(), followUpAt: z.iso.datetime({ offset: true }).nullable() });

const bulk = new Set(["Marketing", "Newsletter", "Spam", "Notification", "Information Only", "Receipt / Invoice"]);
export function propose(e: Evidence, now = Date.now()): TaskKind[] {
  // Neither unread status nor urgency words alone authorize a task.
  if (e.direction === "out") return [];
  if (e.lastUserAt && Date.parse(e.lastUserAt) >= Date.parse(e.sentAt)) return [];
  if (e.lastOtherAt && Date.parse(e.lastOtherAt) > Date.parse(e.sentAt)) return [];
  if (bulk.has(e.classification)) return [];
  const a = e.analysis;
  const context = `${a.intent ?? ""} ${a.summary ?? ""} ${e.title} ${e.body}`;
  if (a.forwardingSuggestion?.recommended) return ["forward"];
  if (/(book|reserve|reservation|boka|bokning|reservera)/i.test(context) && /(hotel|hotell|restaurant|restaurang|table|bord|room|rum)/i.test(context)) return ["website"];
  if (a.requiresReply && /\b(möte|middag|lunch|fika|padel|meeting|dinner|coffee|träffas|ses|appointment)\b/i.test(context)) return ["meeting"];
  if (a.actionSuggestion?.detected) return ["website"];
  if (a.commitment?.detected && a.commitment.owner === "sender") {
    return a.commitment.dueAt && Date.parse(a.commitment.dueAt) < now ? ["follow_up"] : [];
  }
  return a.requiresReply ? ["reply"] : [];
}

/** Deterministic ordering for already-actionable candidates. This intentionally
 * does not decide whether a message needs action: `propose` does that from
 * stored analysis evidence. It keeps unread, relationship-backed requests near
 * the top without promoting campaigns or urgency wording on their own. */
export function candidateRank(e: Evidence, kind: TaskKind, now = Date.now()) {
  const a = e.analysis;
  let score = Math.max(0, Math.min(10, e.priority || 0)) * 10;
  if (e.unread) score += 12;
  if (a.forwardingSuggestion?.recommended) score += 25;
  if (a.actionSuggestion?.detected || kind === "website") score += 18;
  if (kind === "meeting") score += 15;
  if (a.commitment?.detected) score += 10;
  const ageDays = Math.max(0, (now - Date.parse(e.sentAt)) / 86_400_000);
  return score - Math.min(ageDays, 30) * 0.15;
}
export function makePlan(e: Evidence, kind: TaskKind): Plan {
  const draft = kind === "forward" ? e.analysis.forwardingSuggestion?.introduction ?? "" : kind === "follow_up" ? "" : e.analysis.draftResponse ?? "";
  const steps: Record<TaskKind, string[]> = {
    reply: ["Läs original och relationsunderlag", "Granska personligt svar", "Godkänn exakt mottagare och text", "Bevaka svar"],
    forward: ["Kontrollera ärendet", "Välj och verifiera rådgivare", "Granska introduktion och originalets innehåll", "Godkänn vidarebefordran", "Bevaka rådgivarens svar"],
    meeting: ["Granska mötesförfrågan", "Kontrollera masterkalendern", "Välj personer, plats och resa", "Reservera preliminärt", "Godkänn bokning och inbjudningar"],
    follow_up: ["Kontrollera att svar fortfarande saknas", "Förbered en naturlig uppföljning", "Godkänn mottagare och text", "Bevaka svar"],
    website: ["Granska uppgiften och länkens avsändare", "Öppna separat arbetsflöde", "Godkänn extern åtgärd separat"],
  };
  return { evidence: e, draft, originalDraft: draft, reason: e.analysis.forwardingSuggestion?.recommended && kind === "forward" ? e.analysis.forwardingSuggestion.reason : e.analysis.priorityReason ?? e.analysis.summary ?? "Granska originalmeddelandet.", recipientPersonId: kind === "forward" ? null : e.personId, recipient: kind === "forward" ? "" : e.recipient, recipientName: kind === "forward" ? "" : e.personName, followUpAt: null, steps: steps[kind] };
}
export function sendCapability(plan: Plan, kind: TaskKind): string | null {
  if (kind === "website") return "Använd Browserbase-granskningen nedan.";
  if (!["reply", "forward", "follow_up", "meeting"].includes(kind)) return "Använd det separata granskningsflödet nedan.";
  if (!plan.draft.trim()) return "Skriv eller generera ett fullständigt svar först.";
  if (!plan.evidence.connectionId) return "Meddelandet saknar ett entydigt ursprungskonto.";
  if ((plan.evidence.provider === "microsoft-graph" && plan.evidence.source !== "email") || (plan.evidence.provider === "instagram-professional" && plan.evidence.source !== "instagram")) return "Kontot stämmer inte med meddelandets källa.";
  if (plan.evidence.provider === "whatsapp-business") {
    if (plan.evidence.source !== "whatsapp") return "Kontot stämmer inte med meddelandets källa.";
    const at = Date.parse(plan.evidence.lastOtherAt ?? "");
    if (!Number.isFinite(at) || at > Date.now() || Date.now() - at >= 86400000) return "WhatsApps svarsfönster är stängt. Skicka i originalappen.";
  }
  if (plan.evidence.provider === "gmail" && plan.evidence.source !== "email") return "Kontot stämmer inte med meddelandets källa.";
  if (!["microsoft-graph", "gmail", "instagram-professional", "whatsapp-business"].includes(plan.evidence.provider)) return "Direktutskick stöds inte för denna anslutning i handlingsinkorgen. Kopiera texten och skicka i originalappen.";
  if (kind === "forward" && plan.evidence.provider !== "microsoft-graph") return "Vidarebefordran kräver ett Outlook-original.";
  if (!plan.recipient || (kind === "forward" && !plan.recipientPersonId)) return "Välj en verifierad mottagare först.";
  if (kind === "follow_up" && plan.evidence.direction === "out" && plan.evidence.provider === "microsoft-graph" && !plan.recipientPersonId) return "Välj en verifierad kontakt för uppföljningen.";
  if (kind === "follow_up" && plan.evidence.direction === "out" && plan.evidence.provider !== "microsoft-graph" && !plan.evidence.lastOtherAt) return "Denna tråd innehåller inget inkommande original att svara på. Kopiera uppföljningen och skicka i originalappen.";
  return null;
}
export function taskBucket(task: Task, now = Date.now()): "decision" | "ready" | "waiting" | "done" {
  if (task.status === "done" || task.status === "dismissed") return "done";
  if (task.status === "ready") return "ready";
  if (task.kind === "website" && task.status === "waiting") return "decision";
  if (task.status === "waiting" && !task.observedReplyAt && (!task.plan.followUpAt || Date.parse(task.plan.followUpAt) > now)) return "waiting";
  return "decision";
}
export function mayTransition(from: TaskStatus, to: TaskStatus) {
  const allowed: Record<TaskStatus, TaskStatus[]> = {
    decision: ["decision", "ready", "dismissed", "done"], ready: ["decision", "ready", "executing", "dismissed", "done"],
    executing: ["waiting", "uncertain", "done"], waiting: ["decision", "done", "dismissed"],
    uncertain: ["done"], done: [], dismissed: [],
  };
  return allowed[from].includes(to);
}
