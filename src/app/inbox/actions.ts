"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AIServiceNotConfiguredError, getAIService, type DraftTransformation } from "@/lib/ai/service";
import { emailPriority, recommendedEmailAction } from "@/lib/connectors/email-classification";
import { normalizeUniversalProfile, resolveCommunicationProfile, situationForClassification } from "@/lib/communication-profile";
import { createClient } from "@/lib/supabase/server";
import { senderRelevance } from "@/lib/sender-intelligence";
import { normalizeCommitmentDueAt } from "@/lib/commitments";
import { approvedLearningContext, saveLearningSuggestion, toneRule } from "@/lib/learning-feedback";
import { relationshipTypes } from "@/lib/relationship-types";
import { enforceProfessionalRouting } from "@/lib/action-routing";

const categories = ["Critical", "Action Required", "Business", "Customer", "Personal", "Booking / Travel", "Financial", "Legal", "Receipt / Invoice", "Newsletter", "Marketing", "Notification", "Spam", "Information Only"] as const;
const correctionSchema = z.object({ messageId: z.string().uuid(), conversationId: z.string().uuid(), classification: z.enum(categories) });
const analysisRequestSchema = z.object({ messageId: z.string().uuid(), conversationId: z.string().uuid() });
const deepAnalysisRequestSchema = analysisRequestSchema.extend({ researchApproved: z.boolean() });
const draftRevisionRequestSchema = analysisRequestSchema.extend({ currentDraft: z.string().trim().min(1).max(4000), transformation: z.enum(["shorter", "warmer", "more_direct", "more_professional", "more_diplomatic", "rewrite"]) });
const senderPreferenceSchema = z.object({ personId: z.string().uuid(), relationshipType: z.enum(relationshipTypes), manualPriority: z.number().min(1).max(10), handlingRule: z.enum(["normal", "always_priority", "low_priority"]) });
const memoryReviewSchema = z.object({ memoryId: z.string().uuid(), decision: z.enum(["approve", "reject"]) });
const commitmentReviewSchema = z.object({ commitmentId: z.string().uuid(), decision: z.enum(["approve", "reject", "complete"]) });
const manualCommitmentSchema = z.object({ conversationId: z.string().uuid(), messageId: z.string().uuid(), description: z.string().trim().min(1).max(300), owner: z.enum(["user", "sender", "unknown"]), dueAt: z.string().max(40).optional() });

async function loadApprovedLearning(supabase: Awaited<ReturnType<typeof createClient>>, ownerId: string, personId?: string | null) {
  const { data } = await supabase.from("learning_signals").select("person_id,proposed_rule").eq("owner_id", ownerId).eq("source", "email").eq("status", "approved").order("updated_at", { ascending: false }).limit(40);
  return approvedLearningContext((data ?? []).filter((item) => !item.person_id || item.person_id === personId));
}

export async function createManualCommitment(input: { conversationId: string; messageId: string; description: string; owner: "user" | "sender" | "unknown"; dueAt?: string }) {
  const parsed = manualCommitmentSchema.safeParse(input);
  if (!parsed.success) return { error: "Describe the follow-up in 300 characters or fewer." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return { error: "Two-factor authentication is required." };
  const { data: conversation } = await supabase.from("conversations").select("id,person_id").eq("id", parsed.data.conversationId).eq("owner_id", user.id).eq("source", "email").maybeSingle();
  if (!conversation) return { error: "The selected conversation could not be loaded." };
  const dueAt = parsed.data.dueAt ? normalizeCommitmentDueAt(`${parsed.data.dueAt}T12:00:00`) : null;
  const { data: saved, error } = await supabase.from("commitments").upsert({ owner_id: user.id, conversation_id: conversation.id, person_id: conversation.person_id, description: parsed.data.description, commitment_owner: parsed.data.owner, due_at: dueAt, status: "open", source_message_id: parsed.data.messageId, confidence: 1 }, { onConflict: "owner_id,source_message_id,description" }).select("id").single();
  if (error || !saved) return { error: "The follow-up could not be created." };
  await supabase.from("audit_logs").insert({ owner_id: user.id, actor_id: user.id, action: "commitment.created_manually", object_type: "commitment", object_id: saved.id, source: "email", actor_type: "user", new_value: { description: parsed.data.description, owner: parsed.data.owner, due_at: dueAt } });
  revalidatePath("/");
  return { success: true };
}

export async function reviewCommitment(input: { commitmentId: string; decision: "approve" | "reject" | "complete" }) {
  const parsed = commitmentReviewSchema.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid follow-up." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return { error: "Two-factor authentication is required." };
  const { data: commitment } = await supabase.from("commitments").select("id,status,description").eq("id", parsed.data.commitmentId).eq("owner_id", user.id).maybeSingle();
  if (!commitment) return { error: "This follow-up is no longer available." };
  const nextStatus = parsed.data.decision === "approve" ? "open" : parsed.data.decision === "complete" ? "completed" : "dismissed";
  const { error } = await supabase.from("commitments").update({ status: nextStatus, resolved_at: nextStatus === "open" ? null : new Date().toISOString() }).eq("id", commitment.id).eq("owner_id", user.id);
  if (error) return { error: "The follow-up decision could not be saved." };
  await supabase.from("audit_logs").insert({ owner_id: user.id, actor_id: user.id, action: `commitment.${nextStatus}`, object_type: "commitment", object_id: commitment.id, source: "email", actor_type: "user", previous_value: { status: commitment.status }, new_value: { status: nextStatus, description: commitment.description } });
  revalidatePath("/");
  return { success: true };
}

export async function reviewPersonMemory(input: { memoryId: string; decision: "approve" | "reject" }) {
  const parsed = memoryReviewSchema.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid memory suggestion." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return { error: "Two-factor authentication is required." };
  const { data: memory } = await supabase.from("memories").select("id,person_id,category,content,user_verified").eq("id", parsed.data.memoryId).eq("owner_id", user.id).maybeSingle();
  if (!memory || memory.user_verified) return { error: "This memory suggestion is no longer available." };
  const { error } = parsed.data.decision === "approve"
    ? await supabase.from("memories").update({ user_verified: true }).eq("id", memory.id).eq("owner_id", user.id)
    : await supabase.from("memories").delete().eq("id", memory.id).eq("owner_id", user.id);
  if (error) return { error: "The memory decision could not be saved." };
  await supabase.from("audit_logs").insert({ owner_id: user.id, actor_id: user.id, action: `memory.${parsed.data.decision}d`, object_type: "memory", object_id: memory.id, source: "email", actor_type: "user", previous_value: { verified: false }, new_value: { decision: parsed.data.decision, category: memory.category, content: memory.content } });
  revalidatePath("/");
  return { success: true };
}

export async function saveSenderPreferences(input: { personId: string; relationshipType: string; manualPriority: number; handlingRule: string }) {
  const parsed = senderPreferenceSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the sender settings." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return { error: "Two-factor authentication is required." };
  const { error } = await supabase.from("people").update({ relationship_type: parsed.data.relationshipType, manual_priority: parsed.data.manualPriority, email_handling_rule: parsed.data.handlingRule, sender_preferences_verified: true, updated_at: new Date().toISOString() }).eq("id", parsed.data.personId).eq("owner_id", user.id);
  if (error) return { error: "The sender preferences could not be saved." };
  const { data: conversations } = await supabase.from("conversations").select("id,recommended_action,messages(classification,importance_score,sent_at,direction)").eq("owner_id", user.id).eq("person_id", parsed.data.personId).eq("source", "email");
  for (const conversation of conversations ?? []) {
    const latest = [...(conversation.messages ?? [])].filter((message) => message.direction === "in").sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))[0];
    if (!latest) continue;
    const classification = latest.classification ?? "Information Only";
    const relevance = senderRelevance({ basePriority: emailPriority(classification), relationshipType: parsed.data.relationshipType, manualPriority: parsed.data.manualPriority, handlingRule: parsed.data.handlingRule });
    const currentRecommendation = conversation.recommended_action && typeof conversation.recommended_action === "object" && !Array.isArray(conversation.recommended_action) ? conversation.recommended_action as Record<string, unknown> : {};
    await supabase.from("conversations").update({ priority_score: relevance.score, recommended_action: { ...currentRecommendation, action: recommendedEmailAction(classification), relevance_reasons: relevance.reasons }, updated_at: new Date().toISOString() }).eq("id", conversation.id).eq("owner_id", user.id);
  }
  await supabase.from("audit_logs").insert({ owner_id: user.id, actor_id: user.id, action: "sender.preferences_verified", object_type: "person", object_id: parsed.data.personId, source: "email", actor_type: "user", new_value: parsed.data });
  revalidatePath("/");
  return { success: true };
}

export async function correctEmailClassification(input: { messageId: string; conversationId: string; classification: string }) {
  const parsed = correctionSchema.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid category." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return { error: "Two-factor authentication is required." };
  const priority = emailPriority(parsed.data.classification);
  const action = recommendedEmailAction(parsed.data.classification);
  const [{ data: original }, { data: correctionConversation }] = await Promise.all([
    supabase.from("messages").select("classification").eq("id", parsed.data.messageId).eq("owner_id", user.id).maybeSingle(),
    supabase.from("conversations").select("person_id,title").eq("id", parsed.data.conversationId).eq("owner_id", user.id).maybeSingle(),
  ]);
  const { error: messageError } = await supabase.from("messages").update({ classification: parsed.data.classification, importance_score: priority, processed_at: new Date().toISOString() })
    .eq("id", parsed.data.messageId).eq("owner_id", user.id).eq("source", "email");
  if (messageError) return { error: "The category could not be saved." };
  const { error: conversationError } = await supabase.from("conversations").update({ priority_score: priority, recommended_action: { action, reason: `Category corrected by owner: ${parsed.data.classification}` }, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.conversationId).eq("owner_id", user.id).eq("source", "email");
  if (conversationError) return { error: "The recommendation could not be updated." };
  await supabase.from("audit_logs").insert({ owner_id: user.id, actor_id: user.id, action: "message.classification_corrected", object_type: "message", object_id: parsed.data.messageId, source: "email", actor_type: "user", previous_value: { classification: original?.classification }, new_value: { classification: parsed.data.classification } });
  if (original?.classification !== parsed.data.classification) await saveLearningSuggestion(supabase, { ownerId: user.id, personId: correctionConversation?.person_id, conversationId: parsed.data.conversationId, source: "email", signalType: "category_corrected", observation: `You changed this message from ${original?.classification ?? "uncategorized"} to ${parsed.data.classification}.`, proposedRule: `Consider ${parsed.data.classification} for similar messages in this conversation context.`, evidence: { message_id: parsed.data.messageId, previous_category: original?.classification, corrected_category: parsed.data.classification }, confidence: 0.7 });
  revalidatePath("/");
  return { success: true };
}

export async function analyzeEmailWithAI(input: { messageId: string; conversationId: string }) {
  const parsed = analysisRequestSchema.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid email." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return { error: "Two-factor authentication is required." };
  const { data: conversation, error: conversationError } = await supabase.from("conversations").select("id,title,person_id").eq("id", parsed.data.conversationId).eq("owner_id", user.id).eq("source", "email").maybeSingle();
  const { data: message, error: messageError } = await supabase.from("messages").select("id,body_text,classification,metadata").eq("id", parsed.data.messageId).eq("conversation_id", parsed.data.conversationId).eq("owner_id", user.id).eq("source", "email").maybeSingle();
  if (conversationError || messageError || !conversation || !message) return { error: "The selected email could not be loaded." };
  let senderName = "Unknown sender";
  let relationshipContext = "unknown";
  if (conversation.person_id) {
    const { data: person } = await supabase.from("people").select("display_name,relationship_type,organization").eq("id", conversation.person_id).eq("owner_id", user.id).maybeSingle();
    senderName = person?.display_name ?? senderName;
    relationshipContext = [person?.relationship_type, person?.organization].filter(Boolean).join(" at ") || "known email contact";
  }
  try {
    const { data: profile } = await supabase.from("profiles").select("preferences").eq("id", user.id).maybeSingle();
    const profilePreferences = profile?.preferences && typeof profile.preferences === "object" && !Array.isArray(profile.preferences) ? profile.preferences as { communication_persona?: unknown; universal_communication_profile?: unknown } : {};
    const universalProfile = normalizeUniversalProfile(profilePreferences.universal_communication_profile, profilePreferences.communication_persona);
    const learnedContext = await loadApprovedLearning(supabase, user.id, conversation.person_id);
    const personaContext = [resolveCommunicationProfile(universalProfile, { source: "email", personId: conversation.person_id, situation: situationForClassification(message.classification ?? "Business") }), learnedContext ? `Owner-approved learned rules:\n${learnedContext}` : ""].filter(Boolean).join("\n\n");
    const { data: conversationHistory } = await supabase.from("messages").select("direction,body_text").eq("owner_id", user.id).eq("conversation_id", conversation.id).eq("source", "email").order("sent_at", { ascending: false }).limit(12);
    const { data: verifiedMemories } = conversation.person_id ? await supabase.from("memories").select("content").eq("owner_id", user.id).eq("person_id", conversation.person_id).eq("user_verified", true).order("created_at", { ascending: false }).limit(12) : { data: [] };
    const conversationMessages = [...(conversationHistory ?? [])].reverse().map((item) => ({ direction: item.direction as "in" | "out", body: item.body_text ?? "" })).filter((item) => item.body);
    const conversationReplies = (conversationHistory ?? []).filter((item) => item.direction === "out");
    const { data: recentReplies } = await supabase.from("messages").select("body_text").eq("owner_id", user.id).eq("source", "email").eq("direction", "out").order("sent_at", { ascending: false }).limit(8);
    const styleExamples = [...(conversationReplies ?? []), ...(recentReplies ?? [])].map((item) => item.body_text ?? "").filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).slice(0, 6);
    const aiAnalysis = await getAIService().analyzeEmail({ ownerId: user.id, senderName, subject: conversation.title ?? "(No subject)", preview: message.body_text ?? "", currentClassification: message.classification ?? "Information Only", relationshipContext, personaContext, verifiedPersonMemories: (verifiedMemories ?? []).map((item) => item.content), styleExamples, conversationMessages });
    const analysis = enforceProfessionalRouting(aiAnalysis, [conversation.title, ...conversationMessages.map((item) => item.body)].join("\n"));
    const existingMetadata = message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata) ? message.metadata : {};
    const storedAnalysis = { confidence: analysis.confidence, summary: analysis.summary, intent: analysis.intent, priorityReason: analysis.priorityReason, requiresReply: analysis.requiresReply, draftResponse: analysis.draftResponse, draftTone: analysis.draftTone, relationshipSuggestion: analysis.relationshipSuggestion, forwardingSuggestion: analysis.forwardingSuggestion, commitment: analysis.commitment.detected ? { description: analysis.commitment.description, dueAt: analysis.commitment.dueAt, owner: analysis.commitment.owner, confidence: analysis.commitment.confidence } : undefined };
    const now = new Date().toISOString();
    const { error: updateMessageError } = await supabase.from("messages").update({ classification: analysis.category, importance_score: analysis.priorityScore, processed_at: now, metadata: { ...existingMetadata, ai_analysis: storedAnalysis } }).eq("id", message.id).eq("owner_id", user.id);
    if (updateMessageError) return { error: "The AI analysis could not be saved." };
    const { error: updateConversationError } = await supabase.from("conversations").update({ priority_score: analysis.priorityScore, summary: analysis.summary, recommended_action: { action: analysis.recommendedAction, reason: analysis.priorityReason, source: "ai" }, updated_at: now }).eq("id", conversation.id).eq("owner_id", user.id);
    if (updateConversationError) return { error: "The AI recommendation could not be saved." };
    if (conversation.person_id) {
      await supabase.from("memories").delete().eq("owner_id", user.id).eq("source_message_id", message.id).eq("user_verified", false);
      const candidates = analysis.memoryCandidates.filter((candidate) => candidate.confidence >= 0.7).map((candidate) => ({ owner_id: user.id, person_id: conversation.person_id, conversation_id: conversation.id, category: candidate.category, content: candidate.content, confidence: candidate.confidence, source_message_id: message.id, user_verified: false }));
      if (candidates.length) await supabase.from("memories").upsert(candidates, { onConflict: "owner_id,source_message_id,category,content", ignoreDuplicates: true });
    }
    await supabase.from("commitments").delete().eq("owner_id", user.id).eq("source_message_id", message.id).eq("status", "suggested");
    if (analysis.commitment.detected && analysis.commitment.confidence >= 0.7 && analysis.commitment.description.trim()) {
      await supabase.from("commitments").upsert({ owner_id: user.id, conversation_id: conversation.id, person_id: conversation.person_id, description: analysis.commitment.description.trim(), commitment_owner: analysis.commitment.owner, due_at: normalizeCommitmentDueAt(analysis.commitment.dueAt), status: "suggested", source_message_id: message.id, confidence: analysis.commitment.confidence }, { onConflict: "owner_id,source_message_id,description", ignoreDuplicates: true });
    }
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    if (error instanceof AIServiceNotConfiguredError) return { error: "OpenAI is not configured in Vercel yet." };
    console.error("Email AI analysis failed", error instanceof Error ? error.message : "Unknown error");
    return { error: "The email could not be analyzed. Try again." };
  }
}

export async function deeplyAnalyzeEmailWithAI(input: { messageId: string; conversationId: string; researchApproved: boolean }) {
  const parsed = deepAnalysisRequestSchema.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid email." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return { error: "Two-factor authentication is required." };
  const [{ data: conversation }, { data: message }] = await Promise.all([
    supabase.from("conversations").select("id,title,person_id").eq("id", parsed.data.conversationId).eq("owner_id", user.id).eq("source", "email").maybeSingle(),
    supabase.from("messages").select("id,body_text,classification,metadata").eq("id", parsed.data.messageId).eq("conversation_id", parsed.data.conversationId).eq("owner_id", user.id).eq("source", "email").maybeSingle(),
  ]);
  if (!conversation || !message) return { error: "The selected email could not be loaded." };
  try {
    const [{ data: person }, { data: profile }, { data: history }, { data: memories }, { data: recentReplies }] = await Promise.all([
      conversation.person_id ? supabase.from("people").select("display_name,relationship_type,organization").eq("id", conversation.person_id).eq("owner_id", user.id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("profiles").select("preferences").eq("id", user.id).maybeSingle(),
      supabase.from("messages").select("direction,body_text").eq("owner_id", user.id).eq("conversation_id", conversation.id).eq("source", "email").order("sent_at", { ascending: false }).limit(20),
      conversation.person_id ? supabase.from("memories").select("content").eq("owner_id", user.id).eq("person_id", conversation.person_id).eq("user_verified", true).order("created_at", { ascending: false }).limit(16) : Promise.resolve({ data: [] }),
      supabase.from("messages").select("body_text").eq("owner_id", user.id).eq("source", "email").eq("direction", "out").order("sent_at", { ascending: false }).limit(8),
    ]);
    const preferences = profile?.preferences && typeof profile.preferences === "object" && !Array.isArray(profile.preferences) ? profile.preferences as { communication_persona?: unknown; universal_communication_profile?: unknown } : {};
    const universalProfile = normalizeUniversalProfile(preferences.universal_communication_profile, preferences.communication_persona);
    const learnedContext = await loadApprovedLearning(supabase, user.id, conversation.person_id);
    const personaContext = [resolveCommunicationProfile(universalProfile, { source: "email", personId: conversation.person_id, situation: situationForClassification(message.classification ?? "Business") }), learnedContext ? `Owner-approved learned rules:\n${learnedContext}` : ""].filter(Boolean).join("\n\n");
    const conversationMessages = [...(history ?? [])].reverse().map((item) => ({ direction: item.direction as "in" | "out", body: item.body_text ?? "" })).filter((item) => item.body);
    const styleExamples = [...(history ?? []).filter((item) => item.direction === "out"), ...(recentReplies ?? [])].map((item) => item.body_text ?? "").filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).slice(0, 8);
    const analysis = await getAIService().deeplyAnalyzeEmail({ ownerId: user.id, senderName: person?.display_name ?? "Unknown sender", subject: conversation.title ?? "(No subject)", preview: message.body_text ?? "", currentClassification: message.classification ?? "Information Only", relationshipContext: [person?.relationship_type, person?.organization].filter(Boolean).join(" at ") || "unknown", personaContext, verifiedPersonMemories: (memories ?? []).map((item) => item.content), styleExamples, conversationMessages, researchApproved: parsed.data.researchApproved });
    const existingMetadata = message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata) ? message.metadata : {};
    const deepAnalysis = { ...analysis, createdAt: new Date().toISOString(), usedWebResearch: parsed.data.researchApproved };
    const { error } = await supabase.from("messages").update({ metadata: { ...existingMetadata, deep_analysis: deepAnalysis } }).eq("id", message.id).eq("owner_id", user.id);
    if (error) return { error: "The deep analysis could not be saved." };
    await supabase.from("audit_logs").insert({ owner_id: user.id, actor_id: user.id, action: parsed.data.researchApproved ? "message.deep_analysis_researched" : "message.deep_analysis_created", object_type: "message", object_id: message.id, source: "email", actor_type: "user", new_value: { web_research_approved: parsed.data.researchApproved, source_count: analysis.sources.length } });
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    if (error instanceof AIServiceNotConfiguredError) return { error: "OpenAI is not configured in Vercel yet." };
    console.error("Deep email analysis failed", error instanceof Error ? error.message : "Unknown error");
    return { error: "The deep analysis could not be completed. Try again." };
  }
}

export async function reviseEmailDraftWithAI(input: { messageId: string; conversationId: string; currentDraft: string; transformation: DraftTransformation }) {
  const parsed = draftRevisionRequestSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the draft and try again." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return { error: "Two-factor authentication is required." };
  const { data: conversation } = await supabase.from("conversations").select("id,title,person_id").eq("id", parsed.data.conversationId).eq("owner_id", user.id).eq("source", "email").maybeSingle();
  const { data: message } = await supabase.from("messages").select("id,classification").eq("id", parsed.data.messageId).eq("conversation_id", parsed.data.conversationId).eq("owner_id", user.id).eq("source", "email").eq("direction", "in").maybeSingle();
  if (!conversation || !message) return { error: "The selected email could not be loaded." };
  const { data: person } = conversation.person_id ? await supabase.from("people").select("display_name").eq("id", conversation.person_id).eq("owner_id", user.id).maybeSingle() : { data: null };
  try {
    const [{ data: profile }, { data: history }, { data: recentReplies }] = await Promise.all([
      supabase.from("profiles").select("preferences").eq("id", user.id).maybeSingle(),
      supabase.from("messages").select("direction,body_text").eq("owner_id", user.id).eq("conversation_id", conversation.id).eq("source", "email").order("sent_at", { ascending: false }).limit(12),
      supabase.from("messages").select("body_text").eq("owner_id", user.id).eq("source", "email").eq("direction", "out").order("sent_at", { ascending: false }).limit(8),
    ]);
    const preferences = profile?.preferences && typeof profile.preferences === "object" && !Array.isArray(profile.preferences) ? profile.preferences as { communication_persona?: unknown; universal_communication_profile?: unknown } : {};
    const universalProfile = normalizeUniversalProfile(preferences.universal_communication_profile, preferences.communication_persona);
    const learnedContext = await loadApprovedLearning(supabase, user.id, conversation.person_id);
    const personaContext = [resolveCommunicationProfile(universalProfile, { source: "email", personId: conversation.person_id, situation: situationForClassification(message.classification ?? "Business") }), learnedContext ? `Owner-approved learned rules:\n${learnedContext}` : ""].filter(Boolean).join("\n\n");
    const conversationMessages = [...(history ?? [])].reverse().map((item) => ({ direction: item.direction as "in" | "out", body: item.body_text ?? "" })).filter((item) => item.body);
    const styleExamples = [...(history ?? []).filter((item) => item.direction === "out"), ...(recentReplies ?? [])].map((item) => item.body_text ?? "").filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).slice(0, 6);
    const revised = await getAIService().reviseEmailDraft({ ownerId: user.id, senderName: person?.display_name ?? "Unknown sender", subject: conversation.title ?? "(No subject)", currentDraft: parsed.data.currentDraft, transformation: parsed.data.transformation, personaContext, styleExamples, conversationMessages });
    await saveLearningSuggestion(supabase, { ownerId: user.id, personId: conversation.person_id, conversationId: conversation.id, source: "email", signalType: "tone_requested", observation: `You requested “${parsed.data.transformation.replaceAll("_", " ")}” for an AI draft.`, proposedRule: `${toneRule[parsed.data.transformation]} in similar email conversations.`, evidence: { message_id: message.id, transformation: parsed.data.transformation }, confidence: 0.6 });
    return { success: true, draftResponse: revised.draftResponse, draftTone: revised.draftTone };
  } catch (error) {
    if (error instanceof AIServiceNotConfiguredError) return { error: "OpenAI is not configured in Vercel yet." };
    console.error("Email draft revision failed", error instanceof Error ? error.message : "Unknown error");
    return { error: "The reply could not be rewritten. Try again." };
  }
}
