import { NextResponse, type NextRequest } from "next/server";
import { normalizeUniversalProfile, resolveCommunicationProfile, situationForClassification } from "@/lib/communication-profile";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { getAIService } from "@/lib/ai/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeCommitmentDueAt } from "@/lib/commitments";
import { blocksDecisionUntilMediaReady } from "@/lib/media/decision-gate";
import { mediaContextForMessage } from "@/lib/media/context";
import { inboundBurst } from "@/lib/ai/inbound-burst";
import { logOperation } from "@/lib/observability";
import { z } from "zod";
import { refreshRelationshipIntelligence, relationshipContextForAI } from "@/lib/relationship-intelligence-service";
import { emailAnalysisRecoveryCandidates } from "@/lib/email-analysis-recovery";
import { materializeInboundDecision } from "@/lib/assistant/repository";
import { mapWithConcurrency } from "@/lib/bounded-concurrency";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
// Two provider calls run concurrently inside the 60-second Vercel window.
// This services multiple connected accounts without turning one cron tick into
// an unbounded mailbox fan-out or amplifying provider rate limits.
const maxConnectionsPerPass = 2;

type EmailProvider = "gmail" | "microsoft-graph";

function requestedProvider(request: NextRequest): EmailProvider {
  // The Outlook endpoint remains the backward-compatible default. Gmail gets
  // its own Vercel Cron route, but both providers deliberately share the same
  // bounded worker and analysis contract.
  return request.nextUrl.searchParams.get("provider") === "gmail" ? "gmail" : "microsoft-graph";
}

type AdminClient = ReturnType<typeof createAdminClient>;
type Candidate = { id: string; owner_id: string; conversation_id: string; body_text: string | null; sent_at: string | null; classification: string | null; importance_score: number | null; metadata: unknown; attachment_count: number | null };

function metadataObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function analyzeCandidate(supabase: AdminClient, message: Candidate) {
  const { data: conversation } = await supabase.from("conversations").select("id,title,person_id").eq("id", message.conversation_id).eq("owner_id", message.owner_id).maybeSingle();
  if (!conversation) return false;
  const [{ data: person }, { data: profile }, { data: history }, { data: recentReplies }, { data: verifiedMemories }, relationshipIntelligence] = await Promise.all([
    conversation.person_id ? supabase.from("people").select("display_name,relationship_type,organization").eq("id", conversation.person_id).eq("owner_id", message.owner_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("profiles").select("preferences").eq("id", message.owner_id).maybeSingle(),
    supabase.from("messages").select("id,direction,body_text,sent_at").eq("owner_id", message.owner_id).eq("conversation_id", conversation.id).eq("source", "email").order("sent_at", { ascending: false }).limit(30),
    supabase.from("messages").select("body_text").eq("owner_id", message.owner_id).eq("source", "email").eq("direction", "out").order("sent_at", { ascending: false }).limit(8),
    conversation.person_id ? supabase.from("memories").select("content").eq("owner_id", message.owner_id).eq("person_id", conversation.person_id).eq("user_verified", true).order("created_at", { ascending: false }).limit(12) : Promise.resolve({ data: [] }),
    conversation.person_id ? relationshipContextForAI(supabase, message.owner_id, conversation.person_id).catch(() => "") : Promise.resolve(""),
  ]);
  const preferences = metadataObject(profile?.preferences) as { communication_persona?: unknown; universal_communication_profile?: unknown };
  const universalProfile = normalizeUniversalProfile(preferences.universal_communication_profile, preferences.communication_persona);
  const personaContext = resolveCommunicationProfile(universalProfile, { source: "email", personId: conversation.person_id, situation: situationForClassification(message.classification ?? "Business") });
  const conversationMessages = [...(history ?? [])].reverse().map((item) => ({ direction: item.direction as "in" | "out", body: item.body_text ?? "", sentAt: item.sent_at ?? undefined })).filter((item) => item.body);
  const burst = inboundBurst((history ?? []).map((item) => ({ id: item.id, direction: item.direction as "in" | "out", body: item.body_text, sentAt: item.sent_at })), message.id);
  const styleExamples = [...(history ?? []).filter((item) => item.direction === "out"), ...(recentReplies ?? [])].map((item) => item.body_text ?? "").filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).slice(0, 6);
  const analyzedMedia = await mediaContextForMessage(supabase, message.owner_id, message.id);
  const analysis = await getAIService().analyzeEmail({
    ownerId: message.owner_id,
    senderName: person?.display_name ?? "Unknown sender",
    subject: conversation.title ?? "(No subject)",
    preview: burst.text || message.body_text || "",
    messageSentAt: message.sent_at ?? undefined,
    currentClassification: message.classification ?? "Information Only",
    relationshipContext: [[person?.relationship_type, person?.organization].filter(Boolean).join(" at ") || "known email contact", relationshipIntelligence].filter(Boolean).join("\n"),
    personaContext,
    verifiedPersonMemories: (verifiedMemories ?? []).map((item) => item.content),
    styleExamples,
    conversationMessages,
    analyzedMedia,
  });
  const storedAnalysis = { confidence: analysis.confidence, summary: analysis.summary, intent: analysis.intent, priorityReason: analysis.priorityReason, requiresReply: analysis.requiresReply, draftResponse: analysis.draftResponse, draftTone: analysis.draftTone, sendTiming: analysis.sendTiming, assessedMessageIds: burst.messageIds, assessedMessageCount: burst.count, forwardingSuggestion: analysis.forwardingSuggestion, actionSuggestion: analysis.actionSuggestion, commitment: analysis.commitment.detected ? { description: analysis.commitment.description, dueAt: analysis.commitment.dueAt, owner: analysis.commitment.owner, confidence: analysis.commitment.confidence } : undefined };
  const now = new Date().toISOString();
  const { error } = await supabase.from("messages").update({ classification: analysis.category, importance_score: analysis.priorityScore, processed_at: now, metadata: { ...metadataObject(message.metadata), ai_analysis: storedAnalysis, analyzed_automatically: true } }).eq("id", message.id).eq("owner_id", message.owner_id);
  if (error) return false;
  await supabase.from("conversations").update({ priority_score: analysis.priorityScore, summary: analysis.summary, recommended_action: { action: analysis.recommendedAction, reason: analysis.priorityReason, source: "ai" }, updated_at: now }).eq("id", conversation.id).eq("owner_id", message.owner_id);
  if (conversation.person_id) {
    await supabase.from("memories").delete().eq("owner_id", message.owner_id).eq("source_message_id", message.id).eq("user_verified", false);
    const candidates = analysis.memoryCandidates.filter((candidate) => candidate.confidence >= 0.7).map((candidate) => ({ owner_id: message.owner_id, person_id: conversation.person_id, conversation_id: conversation.id, category: candidate.category, content: candidate.content, confidence: candidate.confidence, source_message_id: message.id, user_verified: false }));
    if (candidates.length) await supabase.from("memories").upsert(candidates, { onConflict: "owner_id,source_message_id,category,content", ignoreDuplicates: true });
  }
  await supabase.from("commitments").delete().eq("owner_id", message.owner_id).eq("source_message_id", message.id).eq("status", "suggested");
  if (analysis.commitment.detected && analysis.commitment.confidence >= 0.7 && analysis.commitment.description.trim()) {
    const { data: existingOpen } = await supabase.from("commitments").select("id").eq("owner_id", message.owner_id).eq("source_message_id", message.id).eq("status", "open").limit(1).maybeSingle();
    if (!existingOpen) await supabase.from("commitments").upsert({ owner_id: message.owner_id, conversation_id: conversation.id, person_id: conversation.person_id, description: analysis.commitment.description.trim(), commitment_owner: analysis.commitment.owner, due_at: normalizeCommitmentDueAt(analysis.commitment.dueAt), status: "suggested", source_message_id: message.id, confidence: analysis.commitment.confidence }, { onConflict: "owner_id,source_message_id,description", ignoreDuplicates: true });
  }
  if (conversation.person_id) await refreshRelationshipIntelligence(supabase, message.owner_id, conversation.person_id).catch(() => undefined);
  // Analysis already produced a persisted draft and recommendation. Create the
  // canonical decision now, rather than waiting for a user to press a second
  // "prepare" button in a different view.
  await materializeInboundDecision(supabase, message.owner_id, message.id);
  return true;
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  if (!isAuthorizedCron(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = createAdminClient();
  const requestedOwner = z.string().uuid().safeParse(request.headers.get("x-owner-id"));
  const ownerId = requestedOwner.success ? requestedOwner.data : null;
  const loginTriggered = request.headers.get("x-maintenance-trigger") === "login";
  const provider = requestedProvider(request);
  // Rotate by the least recently attempted account, not only the oldest
  // successful sync. A mailbox with a persistent temporary failure must not
  // occupy every five-minute pass and starve the other connected accounts.
  // Each attempt still updates `updated_at`, so retries remain bounded and
  // every account eventually receives a recovery attempt.
  let connectionQuery = supabase.from("connections").select("owner_id,id,provider").eq("provider", provider).eq("status", "connected").order("updated_at", { ascending: true, nullsFirst: true }).order("last_sync_at", { ascending: true, nullsFirst: true });
  if (ownerId) connectionQuery = connectionQuery.eq("owner_id", ownerId);
  const { data: connections, error } = await connectionQuery.limit(maxConnectionsPerPass);
  if (error) {
    logOperation({ route: provider === "gmail" ? "/api/cron/gmail-intelligence" : "/api/cron/outlook-intelligence", operation: "email_import_and_analysis", outcome: "failed", durationMs: Date.now() - startedAt, requestId: request.headers.get("x-vercel-id"), error: "connections_unavailable" });
    return NextResponse.json({ error: "Connections could not be loaded." }, { status: 500 });
  }

  const syncResults = await mapWithConcurrency(connections ?? [], maxConnectionsPerPass, async (connection) => {
    try {
      const path = connection.provider === "gmail" ? "/api/connectors/google/sync" : "/api/connectors/microsoft/sync";
      const response = await fetch(new URL(`${path}?connectionId=${encodeURIComponent(connection.id)}`, request.url), { method: "POST", headers: { authorization: request.headers.get("authorization")!, "x-owner-id": connection.owner_id, "x-sync-trigger": loginTriggered ? "automatic" : "background" }, signal: AbortSignal.timeout(45_000) });
      const payload = await response.json().catch(() => null) as { code?: unknown } | null;
      // The connector returns only a small, whitelisted code. Persisting that
      // makes Operations useful without ever copying provider response bodies.
      const errorCode = typeof payload?.code === "string" && /^outlook_[a-z0-9_]+$/.test(payload.code)
        ? payload.code
        : response.ok ? undefined : "outlook_sync_failed";
      return { ownerId: connection.owner_id, ok: response.ok, errorCode };
    } catch {
      return { ownerId: connection.owner_id, ok: false, errorCode: "outlook_worker_unavailable" };
    }
  });

  // Provider sync and AI preparation are separate durable stages. Look for a
  // missing analysis payload, rather than `processed_at`: sync routes mark a
  // message imported immediately, and an interrupted worker must still be
  // able to prepare that relevant email on a later pass.
  let pendingQuery = supabase.from("messages").select("id,owner_id,conversation_id,body_text,sent_at,classification,importance_score,metadata,attachment_count").eq("source", "email").eq("direction", "in").contains("metadata", { provider }).order("sent_at", { ascending: false });
  if (ownerId) pendingQuery = pendingQuery.eq("owner_id", ownerId);
  const { data: pending, error: pendingError } = await pendingQuery.limit(ownerId ? 30 : 50);
  if (pendingError) {
    logOperation({
      route: provider === "gmail" ? "/api/cron/gmail-intelligence" : "/api/cron/outlook-intelligence",
      operation: "email_import_and_analysis",
      outcome: "failed",
      durationMs: Date.now() - startedAt,
      requestId: request.headers.get("x-vercel-id"),
      error: "email_analysis_backlog_unavailable",
    });
    return NextResponse.json({ error: "Email analysis backlog could not be loaded." }, { status: 500 });
  }
  const candidates = emailAnalysisRecoveryCandidates(pending ?? [])
    .filter((message) => !blocksDecisionUntilMediaReady(message.metadata, Number(message.attachment_count ?? 0))) as Candidate[];
  const analyzed = (await Promise.allSettled(candidates.map((message) => analyzeCandidate(supabase, message)))).filter((result) => result.status === "fulfilled" && result.value).length;
  const synced = syncResults.filter((result) => result.ok).length;
  const outcome = syncResults.some((result) => !result.ok) ? "failed" : "completed";
  logOperation({
    route: provider === "gmail" ? "/api/cron/gmail-intelligence" : "/api/cron/outlook-intelligence",
    operation: "email_import_and_analysis",
    outcome,
    durationMs: Date.now() - startedAt,
    requestId: request.headers.get("x-vercel-id"),
    counts: { accounts: syncResults.length, synced, analyzed, remainingCandidates: Math.max(0, (pending?.length ?? 0) - candidates.length) },
    error: outcome === "failed" ? syncResults.find((result) => !result.ok)?.errorCode ?? "email_sync_failed" : undefined,
  });
  // The automation dispatcher uses the response status as its durable retry
  // signal. Never report a completed job when a connected mailbox failed to
  // import; otherwise Operations would say "Klar" while the account stays
  // stale indefinitely.
  return NextResponse.json(
    { ok: outcome === "completed", provider, accounts: syncResults.length, synced, analyzed, analysisLimit: 3, ownerId, loginTriggered, errorCode: outcome === "failed" ? syncResults.find((result) => !result.ok)?.errorCode ?? "email_sync_failed" : undefined },
    { status: outcome === "completed" ? 200 : 502, headers: { "Cache-Control": "no-store" } },
  );
}
