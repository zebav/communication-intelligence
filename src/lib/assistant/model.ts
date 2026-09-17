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
  analysis: Partial<EmailAnalysis>; recipient: string; version: string;
};
export type Plan = {
  evidence: Evidence; draft: string; originalDraft: string; reason: string;
  recipientPersonId: string | null; recipient: string; recipientName: string;
  followUpAt: string | null; steps: string[];
};
export type Task = { id: string; message_id: string; kind: TaskKind; status: TaskStatus; revision: number; plan: Plan; result: Record<string, unknown>; created_at: string; updated_at: string; observedReplyAt?: string };
export const editSchema = z.object({ draft: z.string().trim().max(4000), recipientPersonId: z.string().uuid().nullable(), followUpAt: z.iso.datetime({ offset: true }).nullable() });

const bulk = new Set(["Marketing", "Newsletter", "Spam", "Notification", "Information Only", "Receipt / Invoice"]);
export function propose(e: Evidence, now = Date.now()): TaskKind[] {
  // Neither unread status nor urgency words alone authorize a task.
  if (e.direction === "out") return [];
  if (e.lastUserAt && Date.parse(e.lastUserAt) >= Date.parse(e.sentAt)) return [];
  if (e.lastOtherAt && Date.parse(e.lastOtherAt) > Date.parse(e.sentAt)) return [];
  if (bulk.has(e.classification)) return [];
  const a = e.analysis;
  if (a.forwardingSuggestion?.recommended) return ["forward"];
  if (a.requiresReply && /\b(möte|middag|lunch|meeting|dinner|träffas|ses|appointment)\b/i.test(`${a.intent ?? ""} ${e.title}`)) return ["meeting"];
  if (a.actionSuggestion?.detected) return ["website"];
  if (a.commitment?.detected && a.commitment.owner === "sender") {
    return a.commitment.dueAt && Date.parse(a.commitment.dueAt) < now ? ["follow_up"] : [];
  }
  return a.requiresReply ? ["reply"] : [];
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
  if (!["reply", "forward", "follow_up"].includes(kind)) return "Använd det separata granskningsflödet nedan.";
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
