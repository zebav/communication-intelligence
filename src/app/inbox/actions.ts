"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AIServiceNotConfiguredError, getAIService, type DraftTransformation } from "@/lib/ai/service";
import { emailPriority, recommendedEmailAction } from "@/lib/connectors/email-classification";
import { normalizeUniversalProfile, resolveCommunicationProfile, situationForClassification } from "@/lib/communication-profile";
import { createClient } from "@/lib/supabase/server";

const categories = ["Critical", "Action Required", "Business", "Customer", "Personal", "Booking / Travel", "Financial", "Legal", "Receipt / Invoice", "Newsletter", "Marketing", "Notification", "Spam", "Information Only"] as const;
const correctionSchema = z.object({ messageId: z.string().uuid(), conversationId: z.string().uuid(), classification: z.enum(categories) });
const analysisRequestSchema = z.object({ messageId: z.string().uuid(), conversationId: z.string().uuid() });
const draftRevisionRequestSchema = analysisRequestSchema.extend({ currentDraft: z.string().trim().min(1).max(4000), transformation: z.enum(["shorter", "warmer", "more_direct", "more_professional", "more_diplomatic", "rewrite"]) });
const senderPreferenceSchema = z.object({ personId: z.string().uuid(), relationshipType: z.enum(["unknown", "customer", "partner", "investor", "colleague", "supplier", "family", "friend"]), manualPriority: z.number().min(1).max(10), handlingRule: z.enum(["normal", "always_priority", "low_priority"]) });

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
  const { data: original } = await supabase.from("messages").select("classification").eq("id", parsed.data.messageId).eq("owner_id", user.id).maybeSingle();
  const { error: messageError } = await supabase.from("messages").update({ classification: parsed.data.classification, importance_score: priority, processed_at: new Date().toISOString() })
    .eq("id", parsed.data.messageId).eq("owner_id", user.id).eq("source", "email");
  if (messageError) return { error: "The category could not be saved." };
  const { error: conversationError } = await supabase.from("conversations").update({ priority_score: priority, recommended_action: { action, reason: `Category corrected by owner: ${parsed.data.classification}` }, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.conversationId).eq("owner_id", user.id).eq("source", "email");
  if (conversationError) return { error: "The recommendation could not be updated." };
  await supabase.from("audit_logs").insert({ owner_id: user.id, actor_id: user.id, action: "message.classification_corrected", object_type: "message", object_id: parsed.data.messageId, source: "email", actor_type: "user", previous_value: { classification: original?.classification }, new_value: { classification: parsed.data.classification } });
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
    const personaContext = resolveCommunicationProfile(universalProfile, { source: "email", personId: conversation.person_id, situation: situationForClassification(message.classification ?? "Business") });
    const { data: conversationHistory } = await supabase.from("messages").select("direction,body_text").eq("owner_id", user.id).eq("conversation_id", conversation.id).eq("source", "email").order("sent_at", { ascending: false }).limit(12);
    const conversationMessages = [...(conversationHistory ?? [])].reverse().map((item) => ({ direction: item.direction as "in" | "out", body: item.body_text ?? "" })).filter((item) => item.body);
    const conversationReplies = (conversationHistory ?? []).filter((item) => item.direction === "out");
    const { data: recentReplies } = await supabase.from("messages").select("body_text").eq("owner_id", user.id).eq("source", "email").eq("direction", "out").order("sent_at", { ascending: false }).limit(8);
    const styleExamples = [...(conversationReplies ?? []), ...(recentReplies ?? [])].map((item) => item.body_text ?? "").filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).slice(0, 6);
    const analysis = await getAIService().analyzeEmail({ ownerId: user.id, senderName, subject: conversation.title ?? "(No subject)", preview: message.body_text ?? "", currentClassification: message.classification ?? "Information Only", relationshipContext, personaContext, styleExamples, conversationMessages });
    const existingMetadata = message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata) ? message.metadata : {};
    const storedAnalysis = { confidence: analysis.confidence, summary: analysis.summary, intent: analysis.intent, priorityReason: analysis.priorityReason, requiresReply: analysis.requiresReply, draftResponse: analysis.draftResponse, draftTone: analysis.draftTone, commitment: analysis.commitment.detected ? { description: analysis.commitment.description, dueAt: analysis.commitment.dueAt, owner: analysis.commitment.owner, confidence: analysis.commitment.confidence } : undefined };
    const now = new Date().toISOString();
    const { error: updateMessageError } = await supabase.from("messages").update({ classification: analysis.category, importance_score: analysis.priorityScore, processed_at: now, metadata: { ...existingMetadata, ai_analysis: storedAnalysis } }).eq("id", message.id).eq("owner_id", user.id);
    if (updateMessageError) return { error: "The AI analysis could not be saved." };
    const { error: updateConversationError } = await supabase.from("conversations").update({ priority_score: analysis.priorityScore, summary: analysis.summary, recommended_action: { action: analysis.recommendedAction, reason: analysis.priorityReason, source: "ai" }, updated_at: now }).eq("id", conversation.id).eq("owner_id", user.id);
    if (updateConversationError) return { error: "The AI recommendation could not be saved." };
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    if (error instanceof AIServiceNotConfiguredError) return { error: "OpenAI is not configured in Vercel yet." };
    console.error("Email AI analysis failed", error instanceof Error ? error.message : "Unknown error");
    return { error: "The email could not be analyzed. Try again." };
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
    const personaContext = resolveCommunicationProfile(universalProfile, { source: "email", personId: conversation.person_id, situation: situationForClassification(message.classification ?? "Business") });
    const conversationMessages = [...(history ?? [])].reverse().map((item) => ({ direction: item.direction as "in" | "out", body: item.body_text ?? "" })).filter((item) => item.body);
    const styleExamples = [...(history ?? []).filter((item) => item.direction === "out"), ...(recentReplies ?? [])].map((item) => item.body_text ?? "").filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).slice(0, 6);
    const revised = await getAIService().reviseEmailDraft({ ownerId: user.id, senderName: person?.display_name ?? "Unknown sender", subject: conversation.title ?? "(No subject)", currentDraft: parsed.data.currentDraft, transformation: parsed.data.transformation, personaContext, styleExamples, conversationMessages });
    return { success: true, draftResponse: revised.draftResponse, draftTone: revised.draftTone };
  } catch (error) {
    if (error instanceof AIServiceNotConfiguredError) return { error: "OpenAI is not configured in Vercel yet." };
    console.error("Email draft revision failed", error instanceof Error ? error.message : "Unknown error");
    return { error: "The reply could not be rewritten. Try again." };
  }
}
