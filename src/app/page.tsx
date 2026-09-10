import { redirect } from "next/navigation";
import { Workspace } from "@/components/workspace";
import { createClient } from "@/lib/supabase/server";
import { normalizeUniversalProfile } from "@/lib/communication-profile";
import type { ChannelConnection, CommunicationCase, CommunicationOutcome, CommunicationPersonOption, DeepAnalysis, FollowUpCommitment, IntelligentPerson, LearningSignal, Source, SyncedEmailConversation, UniversalCommunicationProfile } from "@/lib/domain";

export const dynamic = "force-dynamic";

function deduplicateStoredSources(sources: DeepAnalysis["sources"] | undefined) {
  if (!Array.isArray(sources)) return [];
  const valid = sources.filter((source) => source && typeof source.url === "string" && /^https?:\/\//.test(source.url));
  const key = (source: DeepAnalysis["sources"][number]) => { try { return new URL(source.url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return source.url; } };
  return valid.filter((source, index) => valid.findIndex((candidate) => key(candidate) === key(source)) === index).slice(0, 8);
}

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!assurance || assurance.currentLevel !== "aal2") redirect("/auth/mfa");

  const { data: profile } = await supabase.from("profiles").select("preferences").eq("id", user.id).maybeSingle();
  const preferences = profile?.preferences && typeof profile.preferences === "object" && !Array.isArray(profile.preferences) ? profile.preferences as { communication_persona?: unknown; universal_communication_profile?: Partial<UniversalCommunicationProfile> } : {};
  const persona = normalizeUniversalProfile(preferences.universal_communication_profile, preferences.communication_persona);

  const { data: personRows } = await supabase.from("people").select("id,display_name,relationship_type,organization,notes,relationship_summary,overall_priority,manual_priority,first_contact_at,last_contact_at").eq("owner_id", user.id).order("display_name").limit(200);
  const profilePeople: CommunicationPersonOption[] = (personRows ?? []).map((person) => ({ id: person.id, name: person.display_name ?? "Unknown person", relationship: person.relationship_type ?? "", organization: person.organization ?? "" }));

  const { data: rows } = await supabase
    .from("conversations")
    .select("id,title,source,created_at,last_message_at,summary,priority_score,recommended_action,people(id,display_name,relationship_type,manual_priority,email_handling_rule),messages(id,body_text,sent_at,direction,classification,importance_score,metadata)")
    .order("created_at", { ascending: false })
    .limit(50);

  const { data: identityRows } = await supabase.from("identities").select("id,person_id,source,external_identifier,verified_match").eq("owner_id", user.id).limit(500);
  const { data: memoryRows } = await supabase.from("memories").select("id,person_id,conversation_id,category,content,confidence,user_verified").eq("owner_id", user.id).order("created_at", { ascending: false }).limit(300);
  const { data: commitmentRows } = await supabase.from("commitments").select("id,person_id,conversation_id,description,commitment_owner,due_at,status,confidence,people(display_name),conversations(title)").eq("owner_id", user.id).in("status", ["suggested", "open"]).order("due_at", { ascending: true, nullsFirst: false }).limit(200);
  const { data: learningRows } = await supabase.from("learning_signals").select("id,source,signal_type,observation,proposed_rule,confidence,status,created_at,people(display_name),conversations(title)").eq("owner_id", user.id).order("created_at", { ascending: false }).limit(200);
  const learningSignals: LearningSignal[] = (learningRows ?? []).map((item) => { const person = Array.isArray(item.people) ? item.people[0] : item.people; const conversation = Array.isArray(item.conversations) ? item.conversations[0] : item.conversations; return { id: item.id, personName: person?.display_name ?? undefined, conversationTitle: conversation?.title ?? undefined, source: item.source as Source, signalType: item.signal_type as LearningSignal["signalType"], observation: item.observation, proposedRule: item.proposed_rule, confidence: Number(item.confidence ?? 0), status: item.status as LearningSignal["status"], createdAt: item.created_at }; });
  const { data: outcomeRows } = await supabase.from("communication_outcomes").select("id,desired_outcome,status,owner_rating,response_time_minutes,user_confirmed,created_at,updated_at,people(display_name),conversations(title)").eq("owner_id", user.id).order("updated_at", { ascending: false }).limit(200);
  const outcomes: CommunicationOutcome[] = (outcomeRows ?? []).map((item) => { const person = Array.isArray(item.people) ? item.people[0] : item.people; const conversation = Array.isArray(item.conversations) ? item.conversations[0] : item.conversations; return { id: item.id, personName: person?.display_name ?? "Unknown person", conversationTitle: conversation?.title ?? "Untitled conversation", desiredOutcome: item.desired_outcome, status: item.status as CommunicationOutcome["status"], ownerRating: item.owner_rating as CommunicationOutcome["ownerRating"], responseTimeMinutes: item.response_time_minutes == null ? undefined : Number(item.response_time_minutes), userConfirmed: item.user_confirmed, createdAt: item.created_at, updatedAt: item.updated_at }; });
  const followUps: FollowUpCommitment[] = (commitmentRows ?? []).map((item) => {
    const person = Array.isArray(item.people) ? item.people[0] : item.people;
    const conversation = Array.isArray(item.conversations) ? item.conversations[0] : item.conversations;
    return { id: item.id, conversationId: item.conversation_id, personName: person?.display_name ?? "Unknown person", conversationTitle: conversation?.title ?? "Untitled conversation", description: item.description, owner: item.commitment_owner === "user" || item.commitment_owner === "sender" ? item.commitment_owner : "unknown", dueAt: item.due_at ?? undefined, status: item.status === "open" ? "open" : "suggested", confidence: Number(item.confidence ?? 0) };
  });

  const { data: connectionRows } = await supabase
    .from("connections")
    .select("id,provider,source,account_name,account_identifier,status,health_status,last_sync_at,capabilities")
    .eq("owner_id", user.id)
    .eq("status", "connected")
    .order("updated_at", { ascending: false });
  const connections: ChannelConnection[] = (connectionRows ?? []).map((item) => ({ id: item.id, provider: item.provider, source: item.source as Source | undefined, accountName: item.account_name ?? undefined, accountIdentifier: item.account_identifier ?? undefined, status: item.status, healthStatus: item.health_status, lastSyncAt: item.last_sync_at ?? undefined, capabilities: item.capabilities && typeof item.capabilities === "object" && !Array.isArray(item.capabilities) ? item.capabilities as Record<string, boolean> : {} }));

  const rawCommunicationCases: CommunicationCase[] = (rows ?? []).filter((row) => row.source !== "email").map((row) => {
    const person = Array.isArray(row.people) ? row.people[0] : row.people;
    const messages = Array.isArray(row.messages) ? row.messages : [];
    const latestMessage = [...messages].filter((message) => message.direction === "in").sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))[0];
    return { id: row.id, personName: person?.display_name ?? "Unknown person", title: row.title ?? "Untitled communication", source: row.source as Source, message: latestMessage?.body_text ?? "", createdAt: row.created_at };
  });
  const communicationCases = [...rawCommunicationCases.reduce((grouped, item) => {
    const key = `${item.source}:${item.personName.trim().toLocaleLowerCase()}`;
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
    const threadMessages = [...messages].sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at))).map((message) => ({ id: message.id, direction: message.direction as "in" | "out", body: message.body_text ?? "", sentAt: message.sent_at })).filter((message) => message.body);
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
      memories: (memoryRows ?? []).filter((memory) => memory.conversation_id === row.id && ["relationship", "fact", "preference", "context"].includes(memory.category)).map((memory) => ({ id: memory.id, category: memory.category as "relationship" | "fact" | "preference" | "context", content: memory.content, confidence: Number(memory.confidence ?? 0), verified: memory.user_verified })),
      threadMessages,
      analysis,
      deepAnalysis,
    };
  });

  const intelligentPeople: IntelligentPerson[] = (personRows ?? []).map((person) => {
    const allPersonConversations = (rows ?? []).filter((row) => {
      const linked = Array.isArray(row.people) ? row.people[0] : row.people;
      return linked?.id === person.id;
    });
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
      id: person.id, name: person.display_name ?? "Unknown person", organization: person.organization ?? "", relationshipType: person.relationship_type ?? "unknown", notes: person.notes ?? "", relationshipSummary: person.relationship_summary ?? "", manualPriority: person.manual_priority == null ? undefined : Number(person.manual_priority), overallPriority: person.overall_priority == null ? undefined : Number(person.overall_priority), firstContactAt: contactDates[0] ?? person.first_contact_at ?? undefined, lastContactAt: contactDates.at(-1) ?? person.last_contact_at ?? undefined,
      identities: (identityRows ?? []).filter((identity) => identity.person_id === person.id).map((identity) => ({ id: identity.id, source: identity.source as Source, identifier: identity.external_identifier, verified: identity.verified_match })),
      memories: (memoryRows ?? []).filter((memory) => memory.person_id === person.id && memory.user_verified && ["relationship", "fact", "preference", "context"].includes(memory.category)).map((memory) => ({ id: memory.id, category: memory.category as "relationship" | "fact" | "preference" | "context", content: memory.content, confidence: Number(memory.confidence ?? 0), verified: true })),
      conversations: personConversations.map((row) => ({ id: row.id, title: row.title ?? "Untitled conversation", source: row.source as Source, lastMessageAt: (Array.isArray(row.messages) ? [...row.messages].sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))[0]?.sent_at : undefined) ?? undefined, summary: typeof row.summary === "string" ? row.summary : "" })).sort((a, b) => String(b.lastMessageAt ?? "").localeCompare(String(a.lastMessageAt ?? ""))),
      openLoops: (commitmentRows ?? []).filter((commitment) => commitment.person_id === person.id && commitment.status === "open").length,
      responseRate: personConversations.length ? Math.round((responseConversations / personConversations.length) * 100) : undefined,
    };
  }).sort((a, b) => (b.lastContactAt ?? "").localeCompare(a.lastContactAt ?? ""));

  return <Workspace
    userEmail={user.email ?? "Private owner"}
    communicationCases={communicationCases}
    connections={connections}
    syncedEmails={syncedEmails}
    followUps={followUps}
    people={intelligentPeople}
    learningSignals={learningSignals}
    outcomes={outcomes}
    persona={persona}
    profilePeople={profilePeople}
  />;
}
