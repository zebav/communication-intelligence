import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emailAnalysisSchema, getAIService } from "@/lib/ai/service";
import { normalizeUniversalProfile, resolveCommunicationProfile, situationForClassification } from "@/lib/communication-profile";
import { approvedLearningContext } from "@/lib/learning-feedback";
import type { Evidence, Plan, Task, TaskStatus } from "./model";
import type { Source } from "@/lib/domain";

const fields = "id,conversation_id,source,direction,body_text,sent_at,classification,importance_score,metadata,identities(external_identifier),conversations(id,title,person_id,connection_id,external_conversation_id,last_user_message_at,last_other_message_at,people(display_name),connections(provider,account_identifier,account_name))";
type Row = Record<string, unknown>;
function object(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function one(value: unknown): Row { return object(Array.isArray(value) ? value[0] : value); }
const str = (value: unknown) => typeof value === "string" ? value : "";
export function evidenceFromRow(value: unknown): Evidence {
  const row = object(value), c = one(row.conversations), p = one(c.people), connection = one(c.connections), identity = one(row.identities);
  const parsed = emailAnalysisSchema.partial().safeParse(object(row.metadata).ai_analysis);
  const e = {
    messageId: str(row.id), conversationId: str(row.conversation_id), personId: str(c.person_id) || null,
    personName: str(p.display_name) || "Okänd kontakt", source: row.source as Source,
    connectionId: str(c.connection_id) || null, provider: str(connection.provider),
    account: str(connection.account_identifier) || str(connection.account_name) || "Konto behöver kontrolleras",
    title: str(c.title), body: str(row.body_text), sentAt: str(row.sent_at), direction: row.direction as "in" | "out",
    lastUserAt: str(c.last_user_message_at) || null, lastOtherAt: str(c.last_other_message_at) || null,
    classification: str(row.classification), priority: Number(row.importance_score ?? 0), analysis: parsed.success ? parsed.data : {},
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
  const query = db.from("messages").select(fields).eq("owner_id", owner).eq("direction", "in").order("created_at", { ascending: false }).order("id", { ascending: false });
  // Cursor is an offset within a bounded page. The UI exposes that this is a sample, not all history.
  const offset = Math.max(0, Number(before) || 0);
  const { data, error } = await query.range(offset, offset + 99);
  if (error) throw new Error("Underlaget kunde inte hämtas. Försök igen; befintliga uppdrag finns kvar.");
  return { messages: (data ?? []).map(evidenceFromRow), next: data?.length === 100 ? String(offset + 100) : null };
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
