import { NextResponse, type NextRequest } from "next/server";
import { normalizeUniversalProfile, resolveCommunicationProfile, situationForClassification } from "@/lib/communication-profile";
import { isRelevantEmail } from "@/lib/connectors/email-classification";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { getAIService } from "@/lib/ai/service";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type AdminClient = ReturnType<typeof createAdminClient>;
type Candidate = { id: string; owner_id: string; conversation_id: string; body_text: string | null; classification: string | null; metadata: unknown };

function metadataObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function analyzeCandidate(supabase: AdminClient, message: Candidate) {
  const { data: conversation } = await supabase.from("conversations").select("id,title,person_id").eq("id", message.conversation_id).eq("owner_id", message.owner_id).maybeSingle();
  if (!conversation) return false;
  const [{ data: person }, { data: profile }, { data: history }, { data: recentReplies }, { data: verifiedMemories }] = await Promise.all([
    conversation.person_id ? supabase.from("people").select("display_name,relationship_type,organization").eq("id", conversation.person_id).eq("owner_id", message.owner_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("profiles").select("preferences").eq("id", message.owner_id).maybeSingle(),
    supabase.from("messages").select("direction,body_text").eq("owner_id", message.owner_id).eq("conversation_id", conversation.id).eq("source", "email").order("sent_at", { ascending: false }).limit(12),
    supabase.from("messages").select("body_text").eq("owner_id", message.owner_id).eq("source", "email").eq("direction", "out").order("sent_at", { ascending: false }).limit(8),
    conversation.person_id ? supabase.from("memories").select("content").eq("owner_id", message.owner_id).eq("person_id", conversation.person_id).eq("user_verified", true).order("created_at", { ascending: false }).limit(12) : Promise.resolve({ data: [] }),
  ]);
  const preferences = metadataObject(profile?.preferences) as { communication_persona?: unknown; universal_communication_profile?: unknown };
  const universalProfile = normalizeUniversalProfile(preferences.universal_communication_profile, preferences.communication_persona);
  const personaContext = resolveCommunicationProfile(universalProfile, { source: "email", personId: conversation.person_id, situation: situationForClassification(message.classification ?? "Business") });
  const conversationMessages = [...(history ?? [])].reverse().map((item) => ({ direction: item.direction as "in" | "out", body: item.body_text ?? "" })).filter((item) => item.body);
  const styleExamples = [...(history ?? []).filter((item) => item.direction === "out"), ...(recentReplies ?? [])].map((item) => item.body_text ?? "").filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).slice(0, 6);
  const analysis = await getAIService().analyzeEmail({
    ownerId: message.owner_id,
    senderName: person?.display_name ?? "Unknown sender",
    subject: conversation.title ?? "(No subject)",
    preview: message.body_text ?? "",
    currentClassification: message.classification ?? "Information Only",
    relationshipContext: [person?.relationship_type, person?.organization].filter(Boolean).join(" at ") || "known email contact",
    personaContext,
    verifiedPersonMemories: (verifiedMemories ?? []).map((item) => item.content),
    styleExamples,
    conversationMessages,
  });
  const storedAnalysis = { confidence: analysis.confidence, summary: analysis.summary, intent: analysis.intent, priorityReason: analysis.priorityReason, requiresReply: analysis.requiresReply, draftResponse: analysis.draftResponse, draftTone: analysis.draftTone, commitment: analysis.commitment.detected ? { description: analysis.commitment.description, dueAt: analysis.commitment.dueAt, owner: analysis.commitment.owner, confidence: analysis.commitment.confidence } : undefined };
  const now = new Date().toISOString();
  const { error } = await supabase.from("messages").update({ classification: analysis.category, importance_score: analysis.priorityScore, processed_at: now, metadata: { ...metadataObject(message.metadata), ai_analysis: storedAnalysis, analyzed_automatically: true } }).eq("id", message.id).eq("owner_id", message.owner_id);
  if (error) return false;
  await supabase.from("conversations").update({ priority_score: analysis.priorityScore, summary: analysis.summary, recommended_action: { action: analysis.recommendedAction, reason: analysis.priorityReason, source: "ai" }, updated_at: now }).eq("id", conversation.id).eq("owner_id", message.owner_id);
  if (conversation.person_id) {
    await supabase.from("memories").delete().eq("owner_id", message.owner_id).eq("source_message_id", message.id).eq("user_verified", false);
    const candidates = analysis.memoryCandidates.filter((candidate) => candidate.confidence >= 0.7).map((candidate) => ({ owner_id: message.owner_id, person_id: conversation.person_id, conversation_id: conversation.id, category: candidate.category, content: candidate.content, confidence: candidate.confidence, source_message_id: message.id, user_verified: false }));
    if (candidates.length) await supabase.from("memories").upsert(candidates, { onConflict: "owner_id,source_message_id,category,content", ignoreDuplicates: true });
  }
  return true;
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = createAdminClient();
  const { data: connections, error } = await supabase.from("connections").select("owner_id").eq("provider", "microsoft-graph").eq("status", "connected").limit(10);
  if (error) return NextResponse.json({ error: "Connections could not be loaded." }, { status: 500 });

  const syncResults = [];
  for (const connection of connections ?? []) {
    try {
      const response = await fetch(new URL("/api/connectors/microsoft/sync", request.url), { method: "POST", headers: { authorization: request.headers.get("authorization")!, "x-owner-id": connection.owner_id, "x-sync-trigger": "background" }, signal: AbortSignal.timeout(45_000) });
      syncResults.push({ ownerId: connection.owner_id, ok: response.ok });
    } catch {
      syncResults.push({ ownerId: connection.owner_id, ok: false });
    }
  }

  const { data: pending } = await supabase.from("messages").select("id,owner_id,conversation_id,body_text,classification,metadata").eq("source", "email").eq("direction", "in").order("sent_at", { ascending: false }).limit(50);
  const candidates = (pending ?? []).filter((message) => isRelevantEmail(message.classification ?? "") && !metadataObject(message.metadata).ai_analysis).slice(0, 3) as Candidate[];
  const analyzed = (await Promise.allSettled(candidates.map((message) => analyzeCandidate(supabase, message)))).filter((result) => result.status === "fulfilled" && result.value).length;
  return NextResponse.json({ ok: true, accounts: syncResults.length, synced: syncResults.filter((result) => result.ok).length, analyzed, analysisLimit: 3 });
}
