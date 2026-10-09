/* eslint-disable react-hooks/purity -- Server-side timing is request-scoped observability, never rendered state. */
import { redirect } from "next/navigation";
import { WorkspaceSnapshot } from "@/components/workspace-snapshot";
import type { View } from "@/components/workspace";
import { createClient } from "@/lib/supabase/server";
import { defaultUniversalProfile, normalizeUniversalProfile } from "@/lib/communication-profile";
import { recentWindowStartIso } from "@/lib/recent-window";
import { logOperation } from "@/lib/observability";
import { newTraceId } from "@/lib/automation-jobs";
import type { CalendarLearningEvent, ChannelConnection, CommunicationCase, CommunicationOutcome, CommunicationPersonOption, DeepAnalysis, FollowUpCommitment, IntelligentPerson, LearningSignal, Source, SyncedEmailConversation, UniversalCommunicationProfile } from "@/lib/domain";

export const dynamic = "force-dynamic";

type WorkspaceMessageRow = {
  id: string;
  conversation_id: string;
  body_text: string | null;
  sent_at: string;
  direction: string;
  classification: string | null;
  importance_score: number | null;
  attachment_count: number | null;
  metadata: unknown;
};

type WorkspaceIdentityRow = {
  id: string;
  person_id: string | null;
  source: string;
  external_identifier: string;
  verified_match: boolean;
};

type WorkspaceMemoryRow = {
  id: string;
  person_id: string | null;
  conversation_id: string | null;
  category: string;
  content: string;
  confidence: number | null;
  user_verified: boolean;
};

type WorkspaceCommitmentRow = {
  person_id: string | null;
  status: string;
};

function deduplicateStoredSources(sources: DeepAnalysis["sources"] | undefined) {
  if (!Array.isArray(sources)) return [];
  const valid = sources.filter((source) => source && typeof source.url === "string" && /^https?:\/\//.test(source.url));
  const key = (source: DeepAnalysis["sources"][number]) => { try { return new URL(source.url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return source.url; } };
  return valid.filter((source, index) => valid.findIndex((candidate) => key(candidate) === key(source)) === index).slice(0, 8);
}

function normalizedConversationText(value: unknown) {
  return String(value ?? "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function isSyntheticTestConversation(row: { title?: unknown; messages?: unknown }) {
  const messages = Array.isArray(row.messages) ? row.messages as Array<{ body_text?: unknown }> : [];
  const title = normalizedConversationText(row.title);
  const bodies = messages.map((message) => normalizedConversationText(message.body_text)).filter(Boolean);
  return title === "test" && bodies.length > 0 && bodies.every((body) => body === "test");
}

type HomeProps = {
  searchParams: Promise<{ view?: string | string[]; source?: string | string[]; decision?: string | string[] }>;
};

const workspaceViews = new Set<View>(["today", "cases", "inbox", "people", "followups", "cleanup", "intelligence", "connections", "settings", "calendar", "assistant", "relationships"]);
const workspaceSources = new Set<Source>(["email", "imessage", "instagram", "whatsapp", "slack", "messenger", "tinder", "tiktok", "linkedin", "manual"]);

export default async function Home({ searchParams }: HomeProps) {
  const workspaceStartedAt = Date.now();
  const workspaceTraceId = newTraceId();
  const params = await searchParams;
  const requestedView = params.view;
  const requestedSource = params.source;
  const requestedDecision = params.decision;
  const initialView: View = requestedView === "sent" ? "inbox" : requestedView === "duplicates" ? "people" : typeof requestedView === "string" && workspaceViews.has(requestedView as View) ? requestedView as View : "today";
  const initialSource = typeof requestedSource === "string" && workspaceSources.has(requestedSource as Source) ? requestedSource as Source : null;
  const initialDecisionId = typeof requestedDecision === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedDecision) ? requestedDecision : undefined;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!assurance || assurance.currentLevel !== "aal2") redirect("/auth/mfa");

  // Keep the first authenticated render small. Embedding every message for every
  // conversation made the landing page grow with the entire mailbox history.
  // Recent message context is loaded below as one bounded payload instead.
  const conversationFields = "id,title,source,conversation_type,created_at,last_message_at,summary,priority_score,recommended_action,people(id,display_name,relationship_type,manual_priority,email_handling_rule)";
  const overviewCutoff = recentWindowStartIso(31);
  const needsPeople = ["people", "inbox", "cases", "settings", "intelligence", "assistant", "calendar"].includes(initialView);
  const needsConversationDetail = ["today", "inbox", "cases", "calendar"].includes(initialView);
  const needsIdentityData = ["people", "inbox", "cases", "settings", "intelligence"].includes(initialView);
  const needsLearning = ["settings", "intelligence"].includes(initialView);
  const needsFollowUps = ["followups", "settings", "intelligence"].includes(initialView);
  const needsOutcomes = ["settings", "intelligence"].includes(initialView);
  const needsCalendarHistory = ["calendar", "settings", "intelligence"].includes(initialView);
  // The client updates the canonical view URL before switching sections, so
  // this server component can keep the bootstrap payload limited to what the
  // active view truly needs. It avoids serializing private data for unused
  // workspace sections while preserving direct links and back/forward use.
  // Each request needs its own cancellation signal. Reusing one shared signal
  // means that one slow optional query aborts every other workspace query at
  // the same instant, leaving a freshly reloaded workspace with no renderable
  // snapshot even though most data was retrieved successfully.
  // Keep the shell usable if an optional data segment becomes slow. The page
  // renders the successful segments and clearly marks any that missed this
  // deadline instead of leaving the user on an indefinite loading screen.
  const workspaceQuerySignal = () => AbortSignal.timeout(6_000);
  const workspaceQueries = Promise.all([
    supabase.rpc("get_universal_communication_profile").abortSignal(workspaceQuerySignal()),
    needsPeople ? supabase.from("people").select("id,display_name,relationship_type,organization,entity_type,professional_specialty,jurisdiction,notes,relationship_summary,overall_priority,manual_priority,first_contact_at,last_contact_at").eq("owner_id", user.id).or("relationship_status.is.null,relationship_status.neq.merged").order("last_contact_at", { ascending: false, nullsFirst: false }).limit(240).abortSignal(workspaceQuerySignal()) : Promise.resolve({ data: [], error: null }),
    // The inbox is the record of what arrived, not merely the short overview.
    // Keep enough email threads here that a busy mailbox cannot make recent,
    // actionable messages disappear behind older conversation activity.
    needsConversationDetail ? supabase.from("conversations").select(conversationFields).eq("owner_id", user.id).eq("source", "email").order("last_message_at", { ascending: false, nullsFirst: false }).limit(100).abortSignal(workspaceQuerySignal()) : Promise.resolve({ data: [], error: null }),
    needsConversationDetail ? supabase.from("conversations").select(conversationFields).eq("owner_id", user.id).neq("source", "email").gte("last_message_at", overviewCutoff).order("last_message_at", { ascending: false, nullsFirst: false }).limit(45).abortSignal(workspaceQuerySignal()) : Promise.resolve({ data: [], error: null }),
    needsIdentityData ? supabase.from("identities").select("id,person_id,source,external_identifier,verified_match").eq("owner_id", user.id).limit(400).abortSignal(workspaceQuerySignal()) : Promise.resolve({ data: [], error: null }),
    needsIdentityData ? supabase.from("memories").select("id,person_id,conversation_id,category,content,confidence,user_verified").eq("owner_id", user.id).order("created_at", { ascending: false }).limit(80).abortSignal(workspaceQuerySignal()) : Promise.resolve({ data: [], error: null }),
    needsFollowUps ? supabase.from("commitments").select("id,person_id,conversation_id,source_message_id,description,commitment_owner,due_at,status,confidence,people(display_name),conversations(title)").eq("owner_id", user.id).in("status", ["suggested", "open"]).order("due_at", { ascending: true, nullsFirst: false }).limit(80).abortSignal(workspaceQuerySignal()) : Promise.resolve({ data: [], error: null }),
    needsLearning ? supabase.from("learning_signals").select("id,source,signal_type,observation,proposed_rule,evidence,confidence,status,learning_mode,fact_state,sensitivity,autonomy_level,auto_applied_at,last_validated_at,correction_count,version,created_at,people(display_name),conversations(title)").eq("owner_id", user.id).order("created_at", { ascending: false }).limit(80).abortSignal(workspaceQuerySignal()) : Promise.resolve({ data: [], error: null }),
    needsOutcomes ? supabase.from("communication_outcomes").select("id,desired_outcome,status,owner_rating,response_time_minutes,user_confirmed,created_at,updated_at,people(display_name),conversations(title)").eq("owner_id", user.id).order("updated_at", { ascending: false }).limit(80).abortSignal(workspaceQuerySignal()) : Promise.resolve({ data: [], error: null }),
    supabase.from("connections").select("id,provider,source,account_name,account_identifier,status,health_status,last_sync_at,capabilities").eq("owner_id", user.id).eq("status", "connected").order("updated_at", { ascending: false }).abortSignal(workspaceQuerySignal()),
    needsCalendarHistory ? supabase.from("calendar_holds").select("id,title,starts_at,ends_at,status").eq("owner_id", user.id).eq("status", "confirmed").order("starts_at", { ascending: false }).limit(50).abortSignal(workspaceQuerySignal()) : Promise.resolve({ data: [], error: null }),
  ]);
  const workspaceLoad = await Promise.race([
    workspaceQueries.then((result) => ({ kind: "loaded" as const, result })),
    new Promise<{ kind: "timed-out" }>((resolve) => setTimeout(() => resolve({ kind: "timed-out" }), 6_500)),
  ]);
  const baseLoadMs = Date.now() - workspaceStartedAt;
  if (workspaceLoad.kind === "timed-out") {
    logOperation({ route: "/", operation: `workspace_load_${initialView}`, outcome: "timed_out", durationMs: baseLoadMs, traceId: workspaceTraceId });
    return <WorkspaceSnapshot key={user.id} failedSections={["Arbetsytans data"]} data={{
      userEmail: user.email ?? "Private owner", communicationCases: [], connections: [], syncedEmails: [], followUps: [], people: [], learningSignals: [], outcomes: [], calendarHistory: [],
      persona: defaultUniversalProfile, profilePeople: [], initialView, initialSource, initialDecisionId,
    }} />;
  }
  const [
    { data: profileRows, error: profileError },
    { data: personRows, error: personError },
    { data: emailRows, error: emailError },
    { data: channelRows, error: channelError },
    { data: identityRows, error: identityError },
    { data: memoryRows, error: memoryError },
    { data: commitmentRows, error: commitmentError },
    { data: learningRows, error: learningError },
    { data: outcomeRows, error: outcomeError },
    { data: connectionRows, error: connectionError },
    { data: calendarHistoryRows, error: calendarHistoryError },
  ] = workspaceLoad.result;
  const conversationRows = [...(emailRows ?? []), ...(channelRows ?? [])];
  const conversationIds = conversationRows.map((row) => row.id);
  const messageLoadStartedAt = Date.now();
  const { data: messageRows, error: messageError } = conversationIds.length && needsConversationDetail
    ? await supabase.from("messages").select("id,conversation_id,body_text,sent_at,direction,classification,importance_score,attachment_count,metadata").eq("owner_id", user.id).in("conversation_id", conversationIds).order("sent_at", { ascending: false }).limit(400).abortSignal(AbortSignal.timeout(6_000))
    : { data: [], error: null };
  const messageLoadMs = Date.now() - messageLoadStartedAt;
  const messagesByConversation = new Map<string, WorkspaceMessageRow[]>();
  for (const message of (messageRows ?? []) as WorkspaceMessageRow[]) {
    const current = messagesByConversation.get(message.conversation_id) ?? [];
    if (current.length < 24) current.push(message);
    messagesByConversation.set(message.conversation_id, current);
  }
  const rows = conversationRows.map((row) => ({ ...row, messages: messagesByConversation.get(row.id) ?? [] }));
  const workspaceIdentities = (identityRows ?? []) as WorkspaceIdentityRow[];
  const workspaceMemories = (memoryRows ?? []) as WorkspaceMemoryRow[];
  const workspaceCommitments = (commitmentRows ?? []) as WorkspaceCommitmentRow[];
  const identitiesByPerson = new Map<string, WorkspaceIdentityRow[]>();
  const memoriesByPerson = new Map<string, WorkspaceMemoryRow[]>();
  const memoriesByConversation = new Map<string, WorkspaceMemoryRow[]>();
  const conversationsByPerson = new Map<string, typeof rows>();
  const openCommitmentsByPerson = new Map<string, number>();
  for (const identity of workspaceIdentities) {
    if (!identity.person_id) continue;
    const current = identitiesByPerson.get(identity.person_id) ?? [];
    current.push(identity);
    identitiesByPerson.set(identity.person_id, current);
  }
  for (const memory of workspaceMemories) {
    if (memory.person_id) {
      const current = memoriesByPerson.get(memory.person_id) ?? [];
      current.push(memory);
      memoriesByPerson.set(memory.person_id, current);
    }
    if (memory.conversation_id) {
      const current = memoriesByConversation.get(memory.conversation_id) ?? [];
      current.push(memory);
      memoriesByConversation.set(memory.conversation_id, current);
    }
  }
  for (const row of rows) {
    const person = Array.isArray(row.people) ? row.people[0] : row.people;
    if (!person?.id || isSyntheticTestConversation(row)) continue;
    const current = conversationsByPerson.get(person.id) ?? [];
    current.push(row);
    conversationsByPerson.set(person.id, current);
  }
  for (const commitment of workspaceCommitments) {
    if (commitment.status !== "open" || !commitment.person_id) continue;
    openCommitmentsByPerson.set(commitment.person_id, (openCommitmentsByPerson.get(commitment.person_id) ?? 0) + 1);
  }
  const profile = Array.isArray(profileRows) ? profileRows[0] : profileRows;
  const loadResults = [
    ["Profil", profileError], ["Kontakter", personError], ["E-post", emailError],
    ["Övriga meddelanden", channelError], ["Meddelanden", messageError], ["Identiteter", identityError],
    ["Minnen", memoryError], ["Follow-ups", commitmentError],
    ["Intelligence", learningError], ["Outcomes", outcomeError], ["Anslutningar", connectionError], ["Kalenderhistorik", calendarHistoryError],
  ] as const;
  const failedSections = loadResults.filter(([, error]) => error).map(([section]) => section);
  logOperation({
    route: "/",
    operation: `workspace_load_${initialView}`,
    outcome: "completed",
    durationMs: Date.now() - workspaceStartedAt,
    traceId: workspaceTraceId,
    counts: {
      base_load_ms: baseLoadMs,
      message_load_ms: messageLoadMs,
      email_conversations: emailRows?.length ?? 0,
      channel_conversations: channelRows?.length ?? 0,
      message_rows: messageRows?.length ?? 0,
      failed_sections: failedSections.length,
    },
  });
  for (const [section, error] of loadResults) {
    if (error) console.error("workspace_load_failed", { section, code: error.code || "request_failed" });
  }
  const preferences = profile?.preferences && typeof profile.preferences === "object" && !Array.isArray(profile.preferences) ? profile.preferences as { communication_persona?: unknown; universal_communication_profile?: Partial<UniversalCommunicationProfile> } : {};
  if (emailError) console.error("workspace_email_load_failed", { code: emailError.code, message: emailError.message });
  const persona = normalizeUniversalProfile(preferences.universal_communication_profile, preferences.communication_persona);
  const profilePeople: CommunicationPersonOption[] = (personRows ?? []).map((person) => ({ id: person.id, name: person.display_name ?? "Unknown person", relationship: person.relationship_type ?? "", organization: person.organization ?? "", professionalSpecialty: person.professional_specialty ?? "", jurisdiction: person.jurisdiction ?? "", entityType: person.entity_type === "person" || person.entity_type === "organization" || person.entity_type === "automated" ? person.entity_type : "unknown", priority: Number(person.manual_priority ?? person.overall_priority ?? 0), lastContactAt: person.last_contact_at ?? undefined }));
  const learningSignals: LearningSignal[] = (learningRows ?? []).map((item) => { const person = Array.isArray(item.people) ? item.people[0] : item.people; const conversation = Array.isArray(item.conversations) ? item.conversations[0] : item.conversations; return { id: item.id, personName: person?.display_name ?? undefined, conversationTitle: conversation?.title ?? undefined, source: item.source as Source, signalType: item.signal_type as LearningSignal["signalType"], observation: item.observation, proposedRule: item.proposed_rule, evidence: item.evidence && typeof item.evidence === "object" && !Array.isArray(item.evidence) ? item.evidence as Record<string, unknown> : {}, confidence: Number(item.confidence ?? 0), status: item.status as LearningSignal["status"], learningMode: item.learning_mode as LearningSignal["learningMode"], factState: item.fact_state as LearningSignal["factState"], sensitivity: item.sensitivity as LearningSignal["sensitivity"], autonomyLevel: item.autonomy_level as LearningSignal["autonomyLevel"], autoAppliedAt: item.auto_applied_at ?? undefined, lastValidatedAt: item.last_validated_at ?? undefined, correctionCount: Number(item.correction_count ?? 0), version: Number(item.version ?? 1), createdAt: item.created_at }; });
  const outcomes: CommunicationOutcome[] = (outcomeRows ?? []).map((item) => { const person = Array.isArray(item.people) ? item.people[0] : item.people; const conversation = Array.isArray(item.conversations) ? item.conversations[0] : item.conversations; return { id: item.id, personName: person?.display_name ?? "Unknown person", conversationTitle: conversation?.title ?? "Untitled conversation", desiredOutcome: item.desired_outcome, status: item.status as CommunicationOutcome["status"], ownerRating: item.owner_rating as CommunicationOutcome["ownerRating"], responseTimeMinutes: item.response_time_minutes == null ? undefined : Number(item.response_time_minutes), userConfirmed: item.user_confirmed, createdAt: item.created_at, updatedAt: item.updated_at }; });
  const calendarHistory: CalendarLearningEvent[] = (calendarHistoryRows ?? []).map((item) => ({
    id: item.id,
    title: item.title,
    startsAt: item.starts_at,
    endsAt: item.ends_at,
    status: item.status as CalendarLearningEvent["status"],
  }));
  const openCommitmentMessages = new Set((commitmentRows ?? []).filter((item) => item.status === "open" && item.source_message_id).map((item) => item.source_message_id));
  const followUps: FollowUpCommitment[] = (commitmentRows ?? []).filter((item) => item.status !== "suggested" || !item.source_message_id || !openCommitmentMessages.has(item.source_message_id)).map((item) => {
    const person = Array.isArray(item.people) ? item.people[0] : item.people;
    const conversation = Array.isArray(item.conversations) ? item.conversations[0] : item.conversations;
    return { id: item.id, sourceMessageId: item.source_message_id ?? undefined, conversationId: item.conversation_id, personName: person?.display_name ?? "Unknown person", conversationTitle: conversation?.title ?? "Untitled conversation", description: item.description, owner: item.commitment_owner === "user" || item.commitment_owner === "sender" ? item.commitment_owner : "unknown", dueAt: item.due_at ?? undefined, status: item.status === "open" ? "open" : "suggested", confidence: Number(item.confidence ?? 0) };
  });

  const connections: ChannelConnection[] = (connectionRows ?? []).map((item) => ({ id: item.id, provider: item.provider, source: item.source as Source | undefined, accountName: item.account_name ?? undefined, accountIdentifier: item.account_identifier ?? undefined, status: item.status, healthStatus: item.health_status, lastSyncAt: item.last_sync_at ?? undefined, capabilities: item.capabilities && typeof item.capabilities === "object" && !Array.isArray(item.capabilities) ? item.capabilities as Record<string, boolean> : {} }));

  const rawCommunicationCases: CommunicationCase[] = (rows ?? []).filter((row) => row.source !== "email" && !isSyntheticTestConversation(row)).map((row) => {
    const person = Array.isArray(row.people) ? row.people[0] : row.people;
    const messages = Array.isArray(row.messages) ? row.messages : [];
    const latestMessage = [...messages].filter((message) => message.direction === "in").sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))[0];
    const metadata = latestMessage?.metadata && typeof latestMessage.metadata === "object" && !Array.isArray(latestMessage.metadata) ? latestMessage.metadata as { ai_analysis?: CommunicationCase["analysis"] } : {};
    const recommendedAction = row.recommended_action && typeof row.recommended_action === "object" && !Array.isArray(row.recommended_action) ? String((row.recommended_action as { action?: unknown }).action ?? "") : "";
    const whatsappIdentities = row.source === "whatsapp" && person?.id ? (identitiesByPerson.get(person.id) ?? []).filter((identity) => identity.source === "whatsapp") : [];
    const whatsappRecipient = whatsappIdentities.length === 1 ? whatsappIdentities[0].external_identifier : undefined;
    return { whatsappRecipient, id: row.id, personId: person?.id, personName: person?.display_name ?? "Unknown person", title: row.title ?? "Untitled communication", source: row.source as Source, message: latestMessage?.body_text ?? "", createdAt: row.created_at, priorityScore: row.priority_score == null ? undefined : Number(row.priority_score), recommendedAction, analysis: metadata.ai_analysis, conversationType: row.conversation_type ?? undefined, threadMessages: [...messages].sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at))).map((item) => ({ id: item.id, direction: item.direction as "in" | "out", body: item.body_text ?? "", sentAt: item.sent_at, attachmentCount: Number(item.attachment_count ?? 0) })).filter((item) => item.body || item.attachmentCount > 0) };
  });
  const communicationCases = [...rawCommunicationCases.reduce((grouped, item) => {
    const messageFingerprint = normalizedConversationText(item.message);
    const key = messageFingerprint ? `${item.source}:${item.personId ?? item.id}:${messageFingerprint}` : `${item.source}:${item.personId ?? item.id}`;
    const current = grouped.get(key);
    if (!current || item.createdAt > current.createdAt) grouped.set(key, item);
    return grouped;
  }, new Map<string, CommunicationCase>()).values()];

  const syncedEmails: SyncedEmailConversation[] = (rows ?? []).filter((row) => row.source === "email").map((row) => {
    const person = Array.isArray(row.people) ? row.people[0] : row.people;
    const messages = Array.isArray(row.messages) ? row.messages : [];
    const latestMessage = [...messages].filter((message) => message.direction === "in").sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))[0];
    const recommendation = row.recommended_action && typeof row.recommended_action === "object" && !Array.isArray(row.recommended_action)
      ? (row.recommended_action as { action?: string }).action
      : undefined;
    const relevanceReasons = row.recommended_action && typeof row.recommended_action === "object" && !Array.isArray(row.recommended_action)
      ? (row.recommended_action as { relevance_reasons?: unknown }).relevance_reasons
      : undefined;
    const metadata = latestMessage?.metadata && typeof latestMessage.metadata === "object" && !Array.isArray(latestMessage.metadata)
      ? latestMessage.metadata as { is_read?: boolean; ai_analysis?: SyncedEmailConversation["analysis"]; deep_analysis?: SyncedEmailConversation["deepAnalysis"] }
      : {};
    const analysis = metadata.ai_analysis && typeof metadata.ai_analysis.draftResponse === "string" ? metadata.ai_analysis : undefined;
    const deepAnalysis = metadata.deep_analysis && typeof metadata.deep_analysis.overview === "string" ? { ...metadata.deep_analysis, sources: deduplicateStoredSources(metadata.deep_analysis.sources) } : undefined;
    const threadMessages = [...messages].sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at))).map((message) => ({ id: message.id, direction: message.direction as "in" | "out", body: message.body_text ?? "", sentAt: message.sent_at, attachmentCount: Number(message.attachment_count ?? 0) })).filter((message) => message.body || message.attachmentCount > 0);
    return {
      id: row.id,
      personId: person?.id ?? "",
      messageId: latestMessage?.id ?? "",
      personName: person?.display_name ?? "Unknown sender",
      title: row.title ?? "(No subject)",
      preview: latestMessage?.body_text ?? "",
      receivedAt: latestMessage?.sent_at ?? row.created_at,
      classification: latestMessage?.classification ?? "Information Only",
      priorityScore: Number(row.priority_score ?? latestMessage?.importance_score ?? 0),
      recommendedAction: recommendation ?? "RESPOND_LATER",
      unread: metadata.is_read === false,
      relationshipType: person?.relationship_type ?? "unknown",
      manualPriority: person?.manual_priority == null ? null : Number(person.manual_priority),
      handlingRule: person?.email_handling_rule === "always_priority" || person?.email_handling_rule === "low_priority" ? person.email_handling_rule : "normal",
      relevanceReasons: Array.isArray(relevanceReasons) ? relevanceReasons.filter((reason): reason is string => typeof reason === "string") : ["Priority currently comes from the message category."],
      memories: (memoriesByConversation.get(row.id) ?? []).filter((memory) => ["relationship", "fact", "preference", "context"].includes(memory.category)).map((memory) => ({ id: memory.id, category: memory.category as "relationship" | "fact" | "preference" | "context", content: memory.content, confidence: Number(memory.confidence ?? 0), verified: memory.user_verified })),
      threadMessages,
      analysis,
      deepAnalysis,
    };
  });

  const intelligentPeople: IntelligentPerson[] = (personRows ?? []).map((person) => {
    const allPersonConversations = conversationsByPerson.get(person.id) ?? [];
    const personConversations = [...allPersonConversations.reduce((grouped, row) => {
      const key = row.source === "email" ? `email:${row.id}` : `${row.source}:imported-thread`;
      const current = grouped.get(key);
      const rowTime = String(row.last_message_at ?? row.created_at ?? "");
      const currentTime = String(current?.last_message_at ?? current?.created_at ?? "");
      if (!current || rowTime > currentTime) grouped.set(key, row);
      return grouped;
    }, new Map<string, (typeof allPersonConversations)[number]>()).values()];
    const responseConversations = personConversations.filter((row) => {
      const messages = Array.isArray(row.messages) ? row.messages : [];
      const latestInbound = [...messages].filter((message) => message.direction === "in").sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))[0];
      return latestInbound && messages.some((message) => message.direction === "out" && String(message.sent_at) > String(latestInbound.sent_at));
    }).length;
    const contactDates = personConversations.flatMap((row) => Array.isArray(row.messages) ? row.messages.map((message) => String(message.sent_at)) : []).filter(Boolean).sort();
    return {
      id: person.id, name: person.display_name ?? "Unknown person", organization: person.organization ?? "", relationshipType: person.relationship_type ?? "unknown", entityType: person.entity_type === "person" || person.entity_type === "organization" || person.entity_type === "automated" ? person.entity_type : "unknown", professionalSpecialty: person.professional_specialty ?? "", jurisdiction: person.jurisdiction ?? "", notes: person.notes ?? "", relationshipSummary: person.relationship_summary ?? "", manualPriority: person.manual_priority == null ? undefined : Number(person.manual_priority), overallPriority: person.overall_priority == null ? undefined : Number(person.overall_priority), firstContactAt: contactDates[0] ?? person.first_contact_at ?? undefined, lastContactAt: contactDates.at(-1) ?? person.last_contact_at ?? undefined,
      identities: (identitiesByPerson.get(person.id) ?? []).map((identity) => ({ id: identity.id, source: identity.source as Source, identifier: identity.external_identifier, verified: identity.verified_match })),
      memories: (memoriesByPerson.get(person.id) ?? []).filter((memory) => memory.user_verified && ["relationship", "fact", "preference", "context"].includes(memory.category)).map((memory) => ({ id: memory.id, category: memory.category as "relationship" | "fact" | "preference" | "context", content: memory.content, confidence: Number(memory.confidence ?? 0), verified: true })),
      conversations: personConversations.map((row) => ({ id: row.id, title: row.title ?? "Untitled conversation", source: row.source as Source, lastMessageAt: (Array.isArray(row.messages) ? [...row.messages].sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))[0]?.sent_at : undefined) ?? undefined, summary: typeof row.summary === "string" ? row.summary : "" })).sort((a, b) => String(b.lastMessageAt ?? "").localeCompare(String(a.lastMessageAt ?? ""))),
      openLoops: openCommitmentsByPerson.get(person.id) ?? 0,
      responseRate: personConversations.length ? Math.round((responseConversations / personConversations.length) * 100) : undefined,
    };
  }).sort((a, b) => (b.lastContactAt ?? "").localeCompare(a.lastContactAt ?? ""));

  return <WorkspaceSnapshot key={user.id} failedSections={failedSections} data={{
    userEmail: user.email ?? "Private owner", communicationCases, connections,
    syncedEmails, followUps, people: intelligentPeople, learningSignals, outcomes, calendarHistory,
    persona, profilePeople, initialView, initialSource, initialDecisionId,
  }} />;
}
