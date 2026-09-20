import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emailAnalysisSchema, getAIService } from "@/lib/ai/service";
import { normalizeUniversalProfile, resolveCommunicationProfile, situationForClassification } from "@/lib/communication-profile";
import { approvedLearningContext } from "@/lib/learning-feedback";
import type { Evidence, Plan, Task, TaskStatus } from "./model";
import type { Source } from "@/lib/domain";

const fields = "id,conversation_id,source,direction,body_text,sent_at,created_at,classification,importance_score,metadata,identities(external_identifier),conversations(id,title,person_id,connection_id,external_conversation_id,last_user_message_at,last_other_message_at,people(display_name),connections(provider,account_identifier,account_name))";
type Row = Record<string, unknown>;
function object(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function one(value: unknown): Row { return object(Array.isArray(value) ? value[0] : value); }
const str = (value: unknown) => typeof value === "string" ? value : "";
const bool = (value: unknown) => typeof value === "boolean" ? value : undefined;
const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** Preserve useful historical evidence when a nested legacy object no longer
 * satisfies every field required by the current analysis schema. */
function storedAnalysis(value: unknown): Partial<import("@/lib/ai/service").EmailAnalysis> {
  const raw = object(value);
  const parsed = emailAnalysisSchema.partial().safeParse(raw);
  if (parsed.success) return parsed.data;

  const commitment = object(raw.commitment), forwarding = object(raw.forwardingSuggestion), action = object(raw.actionSuggestion), relationship = object(raw.relationshipSuggestion);
  return {
    summary: str(raw.summary) || undefined, intent: str(raw.intent) || undefined,
    priorityReason: str(raw.priorityReason) || undefined, requiresReply: bool(raw.requiresReply),
    draftResponse: str(raw.draftResponse) || undefined, draftTone: str(raw.draftTone) || undefined,
    confidence: num(raw.confidence),
    commitment: Object.keys(commitment).length ? {
      detected: bool(commitment.detected) ?? Boolean(str(commitment.description)),
      description: str(commitment.description), dueAt: str(commitment.dueAt),
      owner: (["user", "sender", "unknown"].includes(str(commitment.owner)) ? str(commitment.owner) : "unknown") as "user" | "sender" | "unknown",
      confidence: num(commitment.confidence) ?? 0,
    } : undefined,
    forwardingSuggestion: Object.keys(forwarding).length ? {
      recommended: bool(forwarding.recommended) ?? false,
      recipientRole: (["lawyer", "accountant", "advisor", "insurance_contact", "colleague", "other", "none"].includes(str(forwarding.recipientRole)) ? str(forwarding.recipientRole) : "none") as "lawyer" | "accountant" | "advisor" | "insurance_contact" | "colleague" | "other" | "none",
      reason: str(forwarding.reason), introduction: str(forwarding.introduction),
    } : undefined,
    actionSuggestion: Object.keys(action).length ? {
      detected: bool(action.detected) ?? false,
      type: (["contact_lookup", "web_research", "website_task", "form_completion", "none"].includes(str(action.type)) ? str(action.type) : "none") as "contact_lookup" | "web_research" | "website_task" | "form_completion" | "none",
      task: str(action.task), reason: str(action.reason), targetUrl: str(action.targetUrl),
      requiresLogin: bool(action.requiresLogin) ?? false,
      contactIds: Array.isArray(action.contactIds) ? action.contactIds.filter((id): id is string => typeof id === "string").slice(0, 3) : [],
      confidence: num(action.confidence) ?? 0,
    } : undefined,
    relationshipSuggestion: Object.keys(relationship).length ? {
      type: str(relationship.type) as NonNullable<import("@/lib/ai/service").EmailAnalysis["relationshipSuggestion"]>["type"],
      confidence: num(relationship.confidence) ?? 0, reason: str(relationship.reason),
    } : undefined,
  };
}
export function evidenceFromRow(value: unknown): Evidence {
  const row = object(value), c = one(row.conversations), p = one(c.people), connection = one(c.connections), identity = one(row.identities);
  const e = {
    messageId: str(row.id), conversationId: str(row.conversation_id), personId: str(c.person_id) || null,
    personName: str(p.display_name) || "Okänd kontakt", source: row.source as Source,
    connectionId: str(c.connection_id) || null, provider: str(connection.provider),
    account: str(connection.account_identifier) || str(connection.account_name) || "Konto behöver kontrolleras",
    title: str(c.title), body: str(row.body_text), sentAt: str(row.sent_at), direction: row.direction as "in" | "out",
    lastUserAt: str(c.last_user_message_at) || null, lastOtherAt: str(c.last_other_message_at) || null,
    classification: str(row.classification), priority: Number(row.importance_score ?? 0), analysis: storedAnalysis(object(row.metadata).ai_analysis),
    unread: object(row.metadata).is_read === false || object(row.metadata).isRead === false,
    recipient: row.source === "email" ? str(identity.external_identifier) : str(c.external_conversation_id).split(":").at(-1) ?? "",
  };
  return { ...e, version: createHash("sha256").update(JSON.stringify(e)).digest("hex") };
}
export async function readEvidence(db: SupabaseClient, owner: string, id: string) {
  const { data, error } = await db.from("messages").select(fields).eq("owner_id", owner).eq("id", id).maybeSingle();
  if (error || !data) throw new Error("Originalmeddelandet kunde inte läsas. Inget har skickats.");
  return evidenceFromRow(data);
}
export async function readCandidates(db: SupabaseClient, owner: string, before?: string) {
  // Email and messaging channels have independent pages. The 30-day window is
  // intentional: older unanswered requests remain visible, but bounded reads
  // keep loading the action inbox fast.
  const offset = Math.max(0, Number(before) || 0);
  const query = () => db.from("messages").select(fields).eq("owner_id", owner).eq("direction", "in").order("created_at", { ascending: false }).order("id", { ascending: false });
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const [email, other] = await Promise.all([
    db.from("messages").select(fields).eq("owner_id", owner).eq("direction", "in").eq("source", "email")
      .gte("sent_at", thirtyDaysAgo).order("importance_score", { ascending: false, nullsFirst: false })
      .order("sent_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 99),
    query().neq("source", "email").gte("sent_at", thirtyDaysAgo).range(offset, offset + 99),
  ]);
  if (email.error || other.error) throw new Error("Underlaget kunde inte hämtas. Försök igen; befintliga uppdrag finns kvar.");
  const rows = [...(email.data ?? []), ...(other.data ?? [])].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  return {
    messages: rows.map(evidenceFromRow),
    next: email.data?.length === 100 || other.data?.length === 100 ? String(offset + 100) : null,
    scannedBySource: { email: email.data?.length ?? 0, messaging: other.data?.length ?? 0 },
    emailWindowDays: 30,
  };
}
export async function readTask(db: SupabaseClient, owner: string, id: string): Promise<Task> {
  const { data, error } = await db.from("assistant_tasks").select("*").eq("owner_id", owner).eq("id", id).single();
  if (error || !data) throw new Error("Uppdraget kunde inte läsas.");
  return data as Task;
}
export async function changeTask(db: SupabaseClient, owner: string, task: Task, status: TaskStatus, plan = task.plan, result = task.result): Promise<Task> {
  const { data, error } = await db.from("assistant_tasks").update({ status, plan, result }).eq("owner_id", owner).eq("id", task.id).eq("revision", task.revision).eq("status", task.status).select("*").maybeSingle();
  if (error || !data) throw new Error("Uppdraget har ändrats eller behandlas redan. Hämta det igen innan du fortsätter.");
  return data as Task;
}
export async function verifiedRecipient(db: SupabaseClient, owner: string, personId: string) {
  const [{ data: person, error: pe }, { data: identity, error: ie }] = await Promise.all([
    db.from("people").select("display_name").eq("owner_id", owner).eq("id", personId).maybeSingle(),
    db.from("identities").select("external_identifier").eq("owner_id", owner).eq("person_id", personId).eq("source", "email").eq("verified_match", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (pe || ie || !person || !identity || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.external_identifier)) throw new Error("Kontakten behöver en verifierad e-postadress.");
  return { recipient: String(identity.external_identifier).trim(), recipientName: String(person.display_name) };
}
export async function generateDraft(db: SupabaseClient, owner: string, plan: Plan, followUp: boolean) {
  const e = plan.evidence;
  const [profile, history, memories, rules] = await Promise.all([
    db.from("profiles").select("preferences").eq("id", owner).single(),
    db.from("messages").select("direction,body_text").eq("owner_id", owner).eq("conversation_id", e.conversationId).order("sent_at", { ascending: false }).limit(12),
    e.personId ? db.from("memories").select("content").eq("owner_id", owner).eq("person_id", e.personId).eq("user_verified", true).limit(12) : Promise.resolve({ data: [], error: null }),
    db.from("learning_signals").select("proposed_rule,person_id").eq("owner_id", owner).eq("source", e.source).eq("status", "approved").limit(100),
  ]);
  if ([profile, history, memories, rules].some(r => r.error)) throw new Error("Profil och relationsunderlag kunde inte läsas. Inget standardiserat ersättningssvar har skapats.");
  const prefs = object(profile.data?.preferences);
  const context = resolveCommunicationProfile(normalizeUniversalProfile(prefs.universal_communication_profile, prefs.communication_persona), { source: e.source, personId: e.personId, situation: followUp ? "followUp" : situationForClassification(e.classification) });
  const messages = [...(history.data ?? [])].reverse().map(m => ({ direction: m.direction as "in" | "out", body: String(m.body_text ?? "") }));
  const analysis = await getAIService().analyzeEmail({ ownerId: owner, source: e.source, senderName: e.personName, subject: e.title, preview: followUp ? `Prepare a polite follow-up draft, without claiming any new facts or promises. Original message:\n${e.body}` : e.body, currentClassification: e.classification || "Business", personaContext: context + "\n" + approvedLearningContext((rules.data ?? []).filter(r => !r.person_id || r.person_id === e.personId)), verifiedPersonMemories: (memories.data ?? []).map(m => String(m.content)), conversationMessages: messages, styleExamples: messages.filter(m => m.direction === "out").map(m => m.body).slice(-6) });
  return analysis.draftResponse;
}
