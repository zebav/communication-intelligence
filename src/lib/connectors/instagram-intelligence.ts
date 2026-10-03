import "server-only";
import { normalizeUniversalProfile, resolveCommunicationProfile } from "@/lib/communication-profile";
import { getAIService } from "@/lib/ai/service";
import { relationshipTypes } from "@/lib/relationship-types";
import { createAdminClient } from "@/lib/supabase/admin";
import { blocksDecisionUntilMediaReady } from "@/lib/media/decision-gate";
import { mediaContextForMessage } from "@/lib/media/context";
import { inboundBurst } from "@/lib/ai/inbound-burst";
import { refreshRelationshipIntelligence } from "@/lib/relationship-intelligence-service";

export async function analyzeIncomingInstagramMessage(input: { ownerId: string; conversationId: string; messageId: string; source?: "instagram" | "slack" }) {
  const source = input.source ?? "instagram";
  const database = createAdminClient();
  const [{ data: conversation }, { data: message }, { data: profile }] = await Promise.all([
    database.from("conversations").select("id,title,person_id").eq("id", input.conversationId).eq("owner_id", input.ownerId).eq("source", source).maybeSingle(),
    database.from("messages").select("id,body_text,metadata,direction,sent_at").eq("id", input.messageId).eq("owner_id", input.ownerId).eq("source", source).maybeSingle(),
    database.from("profiles").select("preferences").eq("id", input.ownerId).maybeSingle(),
  ]);
  if (!conversation || !message || message.direction !== "in") return;
  if (blocksDecisionUntilMediaReady(message.metadata)) return;
  const [{ data: person }, { data: history }, { data: memories }, { data: styleRows }] = await Promise.all([
    conversation.person_id ? database.from("people").select("display_name,relationship_type,organization,relationship_summary").eq("id", conversation.person_id).eq("owner_id", input.ownerId).maybeSingle() : Promise.resolve({ data: null }),
    database.from("messages").select("id,direction,body_text,sent_at").eq("owner_id", input.ownerId).eq("conversation_id", conversation.id).eq("source", source).order("sent_at", { ascending: false }).limit(30),
    conversation.person_id ? database.from("memories").select("content").eq("owner_id", input.ownerId).eq("person_id", conversation.person_id).eq("user_verified", true).order("created_at", { ascending: false }).limit(12) : Promise.resolve({ data: [] }),
    database.from("messages").select("body_text").eq("owner_id", input.ownerId).eq("source", source).eq("direction", "out").order("sent_at", { ascending: false }).limit(8),
  ]);
  const preferences = profile?.preferences && typeof profile.preferences === "object" && !Array.isArray(profile.preferences) ? profile.preferences as { communication_persona?: unknown; universal_communication_profile?: unknown } : {};
  const universalProfile = normalizeUniversalProfile(preferences.universal_communication_profile, preferences.communication_persona);
  const messageMetadata = message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata) ? message.metadata as Record<string, unknown> : {};
  const slackMode = source === "slack" && messageMetadata.slack_channel_mode === "work" ? "work" : source === "slack" ? "private" : null;
  const slackContext = slackMode === "work"
    ? "This is a work Slack channel. Prioritize explicit owner mentions, deadlines, questions and requests. Keep the draft concise and professional."
    : slackMode === "private"
      ? "This is a private Slack conversation. Treat it as direct communication, but do not assume a response is needed without a question, request or commitment."
      : "";
  const personaContext = resolveCommunicationProfile(universalProfile, { source, personId: conversation.person_id, situation: person?.relationship_type === "dating" ? "romantic" : "personal" }) + (slackContext ? `\n${slackContext}` : "");
  const conversationMessages = [...(history ?? [])].reverse().map((item) => ({ direction: item.direction as "in" | "out", body: item.body_text ?? "", sentAt: item.sent_at ?? undefined })).filter((item) => item.body);
  const burst = inboundBurst((history ?? []).map((item) => ({ id: item.id, direction: item.direction as "in" | "out", body: item.body_text, sentAt: item.sent_at })), message.id);
  const analyzedMedia = await mediaContextForMessage(database, input.ownerId, message.id);
  const analysis = await getAIService().analyzeEmail({ ownerId: input.ownerId, source, senderName: person?.display_name ?? `${source} contact`, subject: conversation.title ?? `${source} conversation`, preview: burst.text || message.body_text || "", messageSentAt: message.sent_at ?? undefined, currentClassification: "Personal", relationshipContext: [person?.relationship_type, person?.organization, person?.relationship_summary].filter(Boolean).join(" · ") || `new ${source} contact`, personaContext, verifiedPersonMemories: (memories ?? []).map((item) => item.content), styleExamples: (styleRows ?? []).map((item) => item.body_text ?? "").filter(Boolean), conversationMessages, analyzedMedia });
  const existingMetadata = message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata) ? message.metadata : {};
  const now = new Date().toISOString();
  const storedAnalysis = { confidence: analysis.confidence, summary: analysis.summary, intent: analysis.intent, priorityReason: analysis.priorityReason, requiresReply: analysis.requiresReply, draftResponse: analysis.draftResponse, draftTone: analysis.draftTone, sendTiming: analysis.sendTiming, assessedMessageIds: burst.messageIds, assessedMessageCount: burst.count, planningSuggestion: analysis.planningSuggestion, relationshipSuggestion: analysis.relationshipSuggestion, forwardingSuggestion: analysis.forwardingSuggestion, actionSuggestion: analysis.actionSuggestion, commitment: analysis.commitment.detected ? analysis.commitment : undefined };
  const mentionPriority = messageMetadata.slack_mentioned_owner === true ? 9 : 0;
  await database.from("messages").update({ classification: analysis.category, importance_score: Math.max(analysis.priorityScore, mentionPriority), processed_at: now, metadata: { ...existingMetadata, ai_analysis: { ...storedAnalysis, slackRoutine: source === "slack" ? (messageMetadata.slack_mentioned_owner === true ? "owner_mentioned" : slackMode === "work" ? "work_channel" : "private_conversation") : undefined } } }).eq("id", message.id).eq("owner_id", input.ownerId);
  await database.from("conversations").update({ priority_score: Math.max(analysis.priorityScore, mentionPriority), summary: analysis.summary, recommended_action: { action: analysis.recommendedAction, reason: analysis.priorityReason, source: "ai" }, updated_at: now }).eq("id", conversation.id).eq("owner_id", input.ownerId);
  if (conversation.person_id) {
    if ((!person?.relationship_type || person.relationship_type === "unknown") && analysis.relationshipSuggestion.confidence >= 0.8 && relationshipTypes.includes(analysis.relationshipSuggestion.type)) {
      await database.from("people").update({ relationship_type: analysis.relationshipSuggestion.type, relationship_summary: analysis.summary, updated_at: now }).eq("id", conversation.person_id).eq("owner_id", input.ownerId);
    }
    const candidates = analysis.memoryCandidates.filter((candidate) => candidate.confidence >= 0.75).map((candidate) => ({ owner_id: input.ownerId, person_id: conversation.person_id, conversation_id: conversation.id, category: candidate.category, content: candidate.content, confidence: candidate.confidence, source_message_id: message.id, user_verified: false }));
    if (candidates.length) await database.from("memories").upsert(candidates, { onConflict: "owner_id,source_message_id,category,content", ignoreDuplicates: true });
  }
  if (analysis.commitment.detected && analysis.commitment.confidence >= 0.75 && analysis.commitment.description.trim()) {
    await database.from("commitments").upsert({ owner_id: input.ownerId, conversation_id: conversation.id, person_id: conversation.person_id, description: analysis.commitment.description.trim(), commitment_owner: analysis.commitment.owner, due_at: analysis.commitment.dueAt || null, status: "suggested", source_message_id: message.id, confidence: analysis.commitment.confidence }, { onConflict: "owner_id,source_message_id,description", ignoreDuplicates: true });
  }
  if (conversation.person_id) await refreshRelationshipIntelligence(database, input.ownerId, conversation.person_id).catch(() => undefined);
}
