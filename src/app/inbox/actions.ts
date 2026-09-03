"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AIServiceNotConfiguredError, getAIService } from "@/lib/ai/service";
import { emailPriority, recommendedEmailAction } from "@/lib/connectors/email-classification";
import { createClient } from "@/lib/supabase/server";

const categories = ["Critical", "Action Required", "Business", "Customer", "Personal", "Booking / Travel", "Financial", "Legal", "Receipt / Invoice", "Newsletter", "Marketing", "Notification", "Spam", "Information Only"] as const;
const correctionSchema = z.object({ messageId: z.string().uuid(), conversationId: z.string().uuid(), classification: z.enum(categories) });
const analysisRequestSchema = z.object({ messageId: z.string().uuid(), conversationId: z.string().uuid() });

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
  const { error: messageError } = await supabase.from("messages").update({ classification: parsed.data.classification, importance_score: priority, processed_at: new Date().toISOString() })
    .eq("id", parsed.data.messageId).eq("owner_id", user.id).eq("source", "email");
  if (messageError) return { error: "The category could not be saved." };
  const { error: conversationError } = await supabase.from("conversations").update({ priority_score: priority, recommended_action: { action, reason: `Category corrected by owner: ${parsed.data.classification}` }, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.conversationId).eq("owner_id", user.id).eq("source", "email");
  if (conversationError) return { error: "The recommendation could not be updated." };
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
    const { data: conversationReplies } = await supabase.from("messages").select("body_text").eq("owner_id", user.id).eq("conversation_id", conversation.id).eq("source", "email").eq("direction", "out").order("sent_at", { ascending: false }).limit(4);
    const { data: recentReplies } = await supabase.from("messages").select("body_text").eq("owner_id", user.id).eq("source", "email").eq("direction", "out").order("sent_at", { ascending: false }).limit(8);
    const styleExamples = [...(conversationReplies ?? []), ...(recentReplies ?? [])].map((item) => item.body_text ?? "").filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).slice(0, 6);
    const analysis = await getAIService().analyzeEmail({ ownerId: user.id, senderName, subject: conversation.title ?? "(No subject)", preview: message.body_text ?? "", currentClassification: message.classification ?? "Information Only", relationshipContext, styleExamples });
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
