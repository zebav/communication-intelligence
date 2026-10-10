import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emailAnalysisSchema, getAIService } from "@/lib/ai/service";
import { normalizeUniversalProfile, resolveCommunicationProfile, situationForClassification } from "@/lib/communication-profile";
import { approvedLearningContext } from "@/lib/learning-feedback";
import { makePlan, propose, sendCapability, type Evidence, type Plan, type Task, type TaskKind, type TaskStatus } from "./model";
import { verifiedHttpsUrl } from "./browser-url";
import type { Source } from "@/lib/domain";
import { blocksDecisionUntilMediaReady, mediaDecisionState } from "@/lib/media/decision-gate";
import { mediaContextForMessage } from "@/lib/media/context";

const fields = "id,conversation_id,source,direction,body_text,sent_at,created_at,classification,importance_score,attachment_count,metadata,identities(external_identifier),conversations(id,title,person_id,connection_id,external_conversation_id,last_user_message_at,last_other_message_at,people(display_name),connections(provider,account_identifier,account_name))";
type Row = Record<string, unknown>;
function object(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function one(value: unknown): Row { return object(Array.isArray(value) ? value[0] : value); }
const str = (value: unknown) => typeof value === "string" ? value : "";
const bool = (value: unknown) => typeof value === "boolean" ? value : undefined;
const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;

function storedMediaSummaries(value: unknown) {
  const media = object(object(value).media_analysis);
  const values = Array.isArray(media.summaries) ? media.summaries : [];
  return [...new Set(values.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    .slice(0, 4)
    .map((item) => item.slice(0, 700));
}

/** Preserve useful historical evidence when a nested legacy object no longer
 * satisfies every field required by the current analysis schema. */
function storedAnalysis(value: unknown): Partial<import("@/lib/ai/service").EmailAnalysis> {
  const raw = object(value);
  const parsed = emailAnalysisSchema.partial().safeParse(raw);
  if (parsed.success) return parsed.data;

  const commitment = object(raw.commitment), forwarding = object(raw.forwardingSuggestion), action = object(raw.actionSuggestion), relationship = object(raw.relationshipSuggestion);
  const actionSuggestion = Object.keys(action).length ? {
    detected: bool(action.detected) ?? false,
    type: (["contact_lookup", "web_research", "website_task", "form_completion", "none"].includes(str(action.type)) ? str(action.type) : "none") as "contact_lookup" | "web_research" | "website_task" | "form_completion" | "none",
    task: str(action.task), reason: str(action.reason), targetUrl: str(action.targetUrl),
    requiresLogin: bool(action.requiresLogin) ?? false,
    contactIds: Array.isArray(action.contactIds) ? action.contactIds.filter((id): id is string => typeof id === "string").slice(0, 3) : [],
    requiredFields: Array.isArray(action.requiredFields) ? action.requiredFields.flatMap((value) => {
      const field = object(value);
      const kind = str(field.kind);
      const sensitivity = str(field.sensitivity);
      if (!str(field.key) || !str(field.label) || !["text","email","phone","date","username","password","account_number","one_time_code","other"].includes(kind) || !["personal","sensitive","restricted"].includes(sensitivity)) return [];
      return [{ key: str(field.key), label: str(field.label), kind: kind as "text" | "email" | "phone" | "date" | "username" | "password" | "account_number" | "one_time_code" | "other", description: str(field.description), sensitivity: sensitivity as "personal" | "sensitive" | "restricted" }];
    }).slice(0, 12) : [],
    confidence: num(action.confidence) ?? 0,
  } : undefined;
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
      recipientRole: (["lawyer", "accountant", "advisor", "insurance_contact", "colleague", "business_partner", "other", "none"].includes(str(forwarding.recipientRole)) ? str(forwarding.recipientRole) : "none") as "lawyer" | "accountant" | "advisor" | "insurance_contact" | "colleague" | "business_partner" | "other" | "none",
      reason: str(forwarding.reason), introduction: str(forwarding.introduction),
    } : undefined,
    actionSuggestion,
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
    attachmentCount: Number(row.attachment_count ?? 0),
    mediaState: mediaDecisionState(row.metadata, Number(row.attachment_count ?? 0)),
    mediaSummaries: storedMediaSummaries(row.metadata),
    recipient: row.source === "email" ? str(identity.external_identifier) : str(c.external_conversation_id).split(":").at(-1) ?? "",
  };
  const recoveredUrl = verifiedHttpsUrl(e.analysis.actionSuggestion?.targetUrl ?? "", e.body, e.title);
  if (e.analysis.actionSuggestion?.detected && recoveredUrl) e.analysis.actionSuggestion.targetUrl = recoveredUrl;
  const versionEvidence = { ...e, analysis: { ...e.analysis, draftResponse: undefined, draftTone: undefined } };
  return { ...e, version: createHash("sha256").update(JSON.stringify(versionEvidence)).digest("hex") };
}
export async function readEvidence(db: SupabaseClient, owner: string, id: string) {
  const { data, error } = await db.from("messages").select(fields).eq("owner_id", owner).eq("id", id).maybeSingle();
  if (error || !data) throw new Error("Originalmeddelandet kunde inte läsas. Inget har skickats.");
  return evidenceFromRow(data);
}
export type NotificationPeriod = "today" | "yesterday" | "seven_days" | "recovery";

function stockholmDayStart(daysAgo: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (name: string) => parts.find((part) => part.type === name)?.value ?? "01";
  // Noon UTC avoids daylight-saving transitions when calculating the date.
  const day = new Date(`${value("year")}-${value("month")}-${value("day")}T12:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() - daysAgo);
  const year = day.getUTCFullYear(), month = String(day.getUTCMonth() + 1).padStart(2, "0"), date = String(day.getUTCDate()).padStart(2, "0");
  // Use Stockholm's actual UTC offset for the requested date. A fixed +02:00
  // made the "Idag" and "Igår" filters drift by an hour during winter time.
  const offsetParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Stockholm",
    timeZoneName: "longOffset",
  }).formatToParts(new Date(`${year}-${month}-${date}T12:00:00.000Z`));
  const offset = offsetParts.find((part) => part.type === "timeZoneName")?.value?.replace("GMT", "") || "+01:00";
  return `${year}-${month}-${date}T00:00:00${offset}`;
}

function periodRange(period: NotificationPeriod) {
  if (period === "today") return { start: stockholmDayStart(0), end: null, label: "Idag" };
  if (period === "yesterday") return { start: stockholmDayStart(1), end: stockholmDayStart(0), label: "Igår" };
  if (period === "seven_days") return { start: new Date(Date.now() - 7 * 86400000).toISOString(), end: null, label: "Senaste 7 dagarna" };
  return { start: new Date(Date.now() - 90 * 86400000).toISOString(), end: null, label: "Äldre, fortfarande öppna" };
}

export async function readCandidates(db: SupabaseClient, owner: string, before?: string, period: NotificationPeriod = "seven_days") {
  // The first notification-centre response is intentionally bounded. Loading
  // hundreds of rich messages (including full email bodies) made the decision
  // screen slow even before a person could act on the first card. Older items
  // remain available through the cursor and are still ranked by priority.
  // Older, still-open items are intentionally available only through the
  // explicit recovery view. The default must keep the decision queue fresh.
  const pageSize = 60;
  const offset = Math.max(0, Number(before) || 0);
  const query = () => db.from("messages").select(fields).eq("owner_id", owner).eq("direction", "in");
  const range = periodRange(period);
  const applyRange = <T extends { gte: (column: string, value: string) => T; lt: (column: string, value: string) => T }>(query: T) => range.end ? query.gte("sent_at", range.start).lt("sent_at", range.end) : query.gte("sent_at", range.start);
  const [email, other] = await Promise.all([
    applyRange(db.from("messages").select(fields).eq("owner_id", owner).eq("direction", "in").eq("source", "email"))
      .order("importance_score", { ascending: false, nullsFirst: false })
      .order("sent_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + pageSize - 1),
    applyRange(query().neq("source", "email"))
      .order("importance_score", { ascending: false, nullsFirst: false })
      .order("sent_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + pageSize - 1),
  ]);
  if (email.error || other.error) throw new Error("Underlaget kunde inte hämtas. Försök igen; befintliga uppdrag finns kvar.");
  // A backfill can import a month of mail at once. `created_at` would make
  // that historical batch look newer than a message that actually arrived
  // today, so the decision queue must use priority and the original send time.
  const rows = [...(email.data ?? []), ...(other.data ?? [])].sort((a, b) =>
    Number(b.importance_score ?? 0) - Number(a.importance_score ?? 0)
    || String(b.sent_at ?? "").localeCompare(String(a.sent_at ?? ""))
    || String(b.id ?? "").localeCompare(String(a.id ?? "")),
  );
  return {
    // Full originals are fetched again from the database when the owner opens
    // or prepares a task. The queue only needs a safe, readable excerpt.
    messages: rows.map(evidenceFromRow).map((evidence) => ({ ...evidence, body: evidence.body.slice(0, 1_200) })),
    next: email.data?.length === pageSize || other.data?.length === pageSize ? String(offset + pageSize) : null,
    scannedBySource: { email: email.data?.length ?? 0, messaging: other.data?.length ?? 0 },
    emailWindowDays: period === "recovery" ? 90 : period === "seven_days" ? 7 : 1,
    period,
    periodLabel: range.label,
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

/**
 * Persist the decision that was already prepared by the inbound analysis
 * worker. This intentionally does not execute anything, run browser research,
 * or replace an owner-edited task. It makes the same durable task available to
 * Inbox, Today and Notiscenter before the owner opens the message.
 */
export async function materializeInboundDecision(db: SupabaseClient, owner: string, messageId: string) {
  const evidence = await readEvidence(db, owner, messageId);
  const kind = propose(evidence)[0] as TaskKind | undefined;
  if (!kind) return null;

  const plan = makePlan(evidence, kind);
  const { data: created, error } = await db.from("assistant_tasks")
    .upsert({ owner_id: owner, message_id: evidence.messageId, kind, status: "decision", plan }, { onConflict: "owner_id,message_id,kind", ignoreDuplicates: true })
    .select("*")
    .maybeSingle();
  if (error) throw new Error("decision_materialization_failed");
  if (!created) return null;

  const task = created as Task;
  // A reply draft returned by the existing analysis is already bound to the
  // original evidence. Mark it ready only when all deterministic delivery
  // guards pass; otherwise retain the safe review state.
  if (kind === "reply" && !sendCapability(plan, kind)) {
    return changeTask(db, owner, task, "ready", plan);
  }
  return task;
}
export async function persistDraftAnalysis(db: SupabaseClient, owner: string, messageId: string, draftResponse: string, draftTone = "Natural") {
  const { data: row, error: readError } = await db.from("messages").select("metadata").eq("owner_id", owner).eq("id", messageId).maybeSingle();
  if (readError || !row) throw new Error("Originalmeddelandet kunde inte läsas när svaret skulle sparas.");
  const metadata = object(row.metadata);
  const analysis = { ...object(metadata.ai_analysis), draftResponse, draftTone };
  const { error } = await db.from("messages").update({
    metadata: { ...metadata, ai_analysis: analysis, assistant_draft_updated_at: new Date().toISOString() },
  }).eq("owner_id", owner).eq("id", messageId);
  if (error) throw new Error("Det föreslagna svaret kunde inte sparas i konversationen.");
}

export async function verifiedRecipient(db: SupabaseClient, owner: string, personId: string) {
  const [{ data: person, error: pe }, { data: identity, error: ie }] = await Promise.all([
    db.from("people").select("display_name").eq("owner_id", owner).eq("id", personId).maybeSingle(),
    db.from("identities").select("external_identifier").eq("owner_id", owner).eq("person_id", personId).eq("source", "email").eq("verified_match", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (pe || ie || !person || !identity || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.external_identifier)) throw new Error("Kontakten behöver en verifierad e-postadress.");
  return { recipient: String(identity.external_identifier).trim(), recipientName: String(person.display_name) };
}
export async function generateDraft(db: SupabaseClient, owner: string, plan: Plan, followUp: boolean, additionalContext = "") {
  const e = plan.evidence;
  if (blocksDecisionUntilMediaReady({ media_analysis_status: e.mediaState }, e.attachmentCount)) {
    throw new Error("Bilagan behöver analyseras eller granskas innan ett nytt svar kan skapas.");
  }
  const [profile, history, memories, rules, analyzedMedia] = await Promise.all([
    // A profile improves the answer but must never prevent a user from
    // preparing an otherwise valid task. New or migrated users can safely
    // have no row until they save Personal Context for the first time.
    db.from("profiles").select("preferences").eq("id", owner).maybeSingle(),
    db.from("messages").select("direction,body_text").eq("owner_id", owner).eq("conversation_id", e.conversationId).order("sent_at", { ascending: false }).limit(12),
    e.personId ? db.from("memories").select("content").eq("owner_id", owner).eq("person_id", e.personId).eq("user_verified", true).limit(12) : Promise.resolve({ data: [], error: null }),
    db.from("learning_signals").select("proposed_rule,person_id").eq("owner_id", owner).eq("source", e.source).eq("status", "approved").limit(100),
    mediaContextForMessage(db, owner, e.messageId),
  ]);
  if ([profile, history, memories, rules].some(r => r.error)) throw new Error("Relationsunderlaget kunde inte läsas. Försök igen; inget standardiserat ersättningssvar har skapats.");
  const prefs = object(profile.data?.preferences);
  const context = resolveCommunicationProfile(normalizeUniversalProfile(prefs.universal_communication_profile, prefs.communication_persona), { source: e.source, personId: e.personId, situation: followUp ? "followUp" : situationForClassification(e.classification) });
  const messages = [...(history.data ?? [])].reverse().map(m => ({ direction: m.direction as "in" | "out", body: String(m.body_text ?? "") }));
  const analysis = await getAIService().analyzeEmail({ ownerId: owner, source: e.source, senderName: e.personName, subject: e.title, preview: (followUp ? `Prepare a polite follow-up draft, without claiming any new facts or promises. Original message:\n${e.body}` : e.body) + (additionalContext ? `\n\nVerified preparation context from the owner-approved planning step:\n${additionalContext}` : ""), currentClassification: e.classification || "Business", personaContext: context + "\n" + approvedLearningContext((rules.data ?? []).filter(r => !r.person_id || r.person_id === e.personId)), verifiedPersonMemories: (memories.data ?? []).map(m => String(m.content)), conversationMessages: messages, styleExamples: messages.filter(m => m.direction === "out").map(m => m.body).slice(-6), analyzedMedia });
  return analysis.draftResponse;
}
