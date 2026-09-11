import "server-only";
import { normalizeUniversalProfile, resolveCommunicationProfile } from "@/lib/communication-profile";
import { getAIService } from "@/lib/ai/service";
import { relationshipTypes } from "@/lib/relationship-types";
import { createAdminClient } from "@/lib/supabase/admin";

export async function analyzeIncomingInstagramMessage(input: { ownerId: string; conversationId: string; messageId: string }) {
  const database = createAdminClient();
  const [{ data: conversation }, { data: message }, { data: profile }] = await Promise.all([
    database.from("conversations").select("id,title,person_id").eq("id", input.conversationId).eq("owner_id", input.ownerId).eq("source", "instagram").maybeSingle(),
    database.from("messages").select("id,body_text,metadata,direction").eq("id", input.messageId).eq("owner_id", input.ownerId).eq("source", "instagram").maybeSingle(),
    database.from("profiles").select("preferences").eq("id", input.ownerId).maybeSingle(),
  ]);
  if (!conversation || !message || message.direction !== "in") return;
  const [{ data: person }, { data: history }, { data: memories }, { data: styleRows }] = await Promise.all([
    conversation.person_id ? database.from("people").select("display_name,relationship_type,organization,relationship_summary").eq("id", conversation.person_id).eq("owner_id", input.ownerId).maybeSingle() : Promise.resolve({ data: null }),
    database.from("messages").select("direction,body_text").eq("owner_id", input.ownerId).eq("conversation_id", conversation.id).eq("source", "instagram").order("sent_at", { ascending: false }).limit(20),
    conversation.person_id ? database.from("memories").select("content").eq("owner_id", input.ownerId).eq("person_id", conversation.person_id).eq("user_verified", true).order("created_at", { ascending: false }).limit(12) : Promise.resolve({ data: [] }),
    database.from("messages").select("body_text").eq("owner_id", input.ownerId).eq("source", "instagram").eq("direction", "out").order("sent_at", { ascending: false }).limit(8),
  ]);
  const preferences = profile?.preferences && typeof profile.preferences === "object" && !Array.isArray(profile.preferences) ? profile.preferences as { communication_persona?: unknown; universal_communication_profile?: unknown } : {};
  const universalProfile = normalizeUniversalProfile(preferences.universal_communication_profile, preferences.communication_persona);
  const personaContext = resolveCommunicationProfile(universalProfile, { source: "instagram", personId: conversation.person_id, situation: person?.relationship_type === "dating" ? "romantic" : "personal" });
  const conversationMessages = [...(history ?? [])].reverse().map((item) => ({ direction: item.direction as "in" | "out", body: item.body_text ?? "" })).filter((item) => item.body);
  const analysis = await getAIService().analyzeEmail({ ownerId: input.ownerId, source: "instagram", senderName: person?.display_name ?? "Instagram contact", subject: conversation.title ?? "Instagram conversation", preview: message.body_text ?? "", currentClassification: "Personal", relationshipContext: [person?.relationship_type, person?.organization, person?.relationship_summary].filter(Boolean).join(" · ") || "new Instagram contact", personaContext, verifiedPersonMemories: (memories ?? []).map((item) => item.content), styleExamples: (styleRows ?? []).map((item) => item.body_text ?? "").filter(Boolean), conversationMessages });
  const existingMetadata = message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata) ? message.metadata : {};
  const now = new Date().toISOString();
  const storedAnalysis = { confidence: analysis.confidence, summary: analysis.summary, intent: analysis.intent, priorityReason: analysis.priorityReason, requiresReply: analysis.requiresReply, draftResponse: analysis.draftResponse, draftTone: analysis.draftTone, relationshipSuggestion: analysis.relationshipSuggestion, commitment: analysis.commitment.detected ? analysis.commitment : undefined };
  await database.from("messages").update({ classification: analysis.category, importance_score: analysis.priorityScore, processed_at: now, metadata: { ...existingMetadata, ai_analysis: storedAnalysis } }).eq("id", message.id).eq("owner_id", input.ownerId);
  await database.from("conversations").update({ priority_score: analysis.priorityScore, summary: analysis.summary, recommended_action: { action: analysis.recommendedAction, reason: analysis.priorityReason, source: "ai" }, updated_at: now }).eq("id", conversation.id).eq("owner_id", input.ownerId);
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
}
