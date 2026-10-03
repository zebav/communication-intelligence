import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { categoryForLegacyRelationship, relationshipCategories, scoreRelationship, type RelationshipCategory, type RelationshipSignal } from "@/lib/relationship-intelligence";

type Json = Record<string, unknown>;
const record = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const signalScore = (value: number) => Math.max(0, Math.min(100, value));

/**
 * Compact, evidence-backed context for the existing message analysis.  It is
 * deliberately descriptive rather than an instruction to elevate every
 * message: message urgency, deadlines and explicit requests still decide the
 * final priority.
 */
export async function relationshipContextForAI(database: SupabaseClient, ownerId: string, personId: string) {
  const { data } = await database
    .from("relationship_snapshots")
    .select("category,strength_score,quality_score,priority_score,confidence,trend")
    .eq("owner_id", ownerId)
    .eq("person_id", personId)
    .order("snapshot_date", { ascending: false })
    .limit(12);
  const seen = new Set<string>();
  const current = (data ?? []).filter((row) => !seen.has(row.category) && Boolean(seen.add(row.category))).slice(0, 3);
  if (!current.length) return "";
  return `Relationship evidence (use as context, not as a substitute for message urgency): ${current.map((row) => `${String(row.category).replaceAll("_", " ")} — strength ${Math.round(Number(row.strength_score ?? 0))}, quality ${Math.round(Number(row.quality_score ?? 0))}, owner priority ${Math.round(Number(row.priority_score ?? 0))}, ${Math.round(Number(row.confidence ?? 0) * 100)}% confidence, ${row.trend ?? "stable"}`).join("; ")}.`;
}

function suggestionCategory(metadata: unknown) {
  const type = record(record(metadata).ai_analysis).relationshipSuggestion;
  return categoryForLegacyRelationship(typeof type === "object" && type ? String(record(type).type) : null);
}

function categoryCandidates(input: { legacyType?: string | null; messages: Array<{ metadata: unknown }>; feedback: Array<{ category: string | null; feedback_type: string }> }) {
  const categories = new Map<RelationshipCategory, number>();
  const legacy = categoryForLegacyRelationship(input.legacyType);
  if (legacy) categories.set(legacy, 1);
  for (const message of input.messages) {
    const category = suggestionCategory(message.metadata);
    if (category) categories.set(category, Math.max(categories.get(category) ?? 0, 0.7));
  }
  for (const feedback of input.feedback) {
    const category = feedback.category as RelationshipCategory | null;
    if (category && relationshipCategories.includes(category) && feedback.feedback_type === "category_confirmed") categories.set(category, 1);
    if (category && feedback.feedback_type === "category_rejected") categories.delete(category);
  }
  return categories;
}

/**
 * Rebuild one person's current, evidence-backed relationship snapshots.
 * It uses persisted normalized data only, is idempotent, and intentionally
 * stores concise signals instead of duplicating private message text.
 */
export async function refreshRelationshipIntelligence(database: SupabaseClient, ownerId: string, personId: string) {
  const [{ data: person }, { data: conversations }, { data: commitments }, { data: feedback }] = await Promise.all([
    database.from("people").select("relationship_type,manual_priority,entity_type").eq("owner_id", ownerId).eq("id", personId).maybeSingle(),
    database.from("conversations").select("id,source,last_message_at,last_user_message_at,last_other_message_at").eq("owner_id", ownerId).eq("person_id", personId).neq("status", "archived").limit(250),
    database.from("commitments").select("id,status,created_at,resolved_at").eq("owner_id", ownerId).eq("person_id", personId).limit(100),
    database.from("relationship_feedback").select("category,feedback_type").eq("owner_id", ownerId).eq("person_id", personId).order("created_at", { ascending: false }).limit(100),
  ]);
  if (!person || person.entity_type === "automated") return { updated: 0, reason: "not_a_qualified_person" };
  const conversationIds = (conversations ?? []).map((item: { id: string }) => item.id);
  if (!conversationIds.length && !categoryForLegacyRelationship(person.relationship_type)) return { updated: 0, reason: "no_meaningful_communication" };
  const { data: messages } = conversationIds.length
    ? await database.from("messages").select("id,conversation_id,direction,sent_at,metadata").eq("owner_id", ownerId).in("conversation_id", conversationIds).order("sent_at", { ascending: false }).limit(300)
    : { data: [] };
  const messageRows = messages ?? [];
  const categories = categoryCandidates({ legacyType: person.relationship_type, messages: messageRows, feedback: feedback ?? [] });
  // A weak contact without a confirmed role is deliberately not ranked.
  if (!categories.size && messageRows.length >= 6) categories.set("other", 0.45);
  const updated: RelationshipCategory[] = [];
  for (const [category, categoryConfidence] of categories) {
    const signals: RelationshipSignal[] = messageRows.map((message: { id: string; direction: "in" | "out"; sent_at: string; metadata: unknown }) => ({
      type: "interaction", score: 60, confidence: 0.9, observedAt: message.sent_at, direction: message.direction, sourceType: "message", sourceId: message.id, summary: `${message.direction === "in" ? "Incoming" : "Outgoing"} communication observed`,
    }));
    const inbound = messageRows.filter((message: { direction: string }) => message.direction === "in").length;
    const outbound = messageRows.filter((message: { direction: string }) => message.direction === "out").length;
    if (inbound + outbound >= 2) {
      const balance = 100 - Math.min(100, Math.abs(inbound - outbound) / Math.max(1, inbound + outbound) * 170);
      for (const conversation of conversations ?? []) signals.push({ type: "reciprocity", score: signalScore(balance), confidence: 0.75, observedAt: conversation.last_message_at ?? new Date().toISOString(), direction: "mutual", sourceType: "conversation", sourceId: conversation.id, summary: "Two-way communication balance observed" });
    }
    for (const commitment of commitments ?? []) signals.push({ type: commitment.status === "completed" ? "reliability" : "commitment", score: commitment.status === "completed" ? 85 : commitment.status === "open" ? 65 : 45, confidence: 0.8, observedAt: commitment.resolved_at ?? commitment.created_at, direction: "mutual", sourceType: "commitment", sourceId: commitment.id, summary: commitment.status === "completed" ? "Commitment completed" : "Relationship commitment remains open" });
    if (categoryForLegacyRelationship(person.relationship_type) === category) signals.push({ type: "owner_context", score: 90, confidence: 1, observedAt: new Date().toISOString(), direction: "owner", sourceType: "contact", sourceId: personId, summary: "Owner-confirmed relationship context" });
    const { data: previousRows } = await database.from("relationship_snapshots").select("ranking_score,snapshot_date").eq("owner_id", ownerId).eq("person_id", personId).eq("category", category).order("snapshot_date", { ascending: false }).limit(2);
    const previous = (previousRows ?? []).find((row: { snapshot_date: string }) => row.snapshot_date !== new Date().toISOString().slice(0, 10));
    const scored = scoreRelationship({ category, categoryConfidence, manualPriority: person.manual_priority, previousRankingScore: previous?.ranking_score == null ? null : Number(previous.ranking_score), signals });
    const dimensions = { interaction_frequency: scored.interactionFrequencyScore, recency: scored.recencyScore, reciprocity: scored.reciprocityScore, responsiveness: scored.responsivenessScore, emotional_depth: scored.emotionalDepthScore, reliability: scored.reliabilityScore, shared_context: scored.sharedContextScore, trajectory: scored.trajectoryScore };
    const { data: snapshot, error } = await database.from("relationship_snapshots").upsert({ owner_id: ownerId, person_id: personId, category, category_confidence: categoryConfidence, strength_score: scored.strengthScore, quality_score: scored.qualityScore, priority_score: scored.priorityScore, ranking_score: scored.rankingScore, interaction_frequency_score: scored.interactionFrequencyScore, recency_score: scored.recencyScore, reciprocity_score: scored.reciprocityScore, responsiveness_score: scored.responsivenessScore, emotional_depth_score: scored.emotionalDepthScore, reliability_score: scored.reliabilityScore, shared_context_score: scored.sharedContextScore, trajectory_score: scored.trajectoryScore, category_dimensions: dimensions, confidence: scored.confidence, evidence_count: scored.evidenceCount, evidence_coverage: scored.evidenceCoverage, trend: scored.trend, explanation: scored.explanation, missing_information: scored.missingInformation, last_analyzed_message_id: messageRows[0]?.id ?? null, last_analyzed_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "owner_id,person_id,category,snapshot_date" }).select("id").maybeSingle();
    if (error || !snapshot) continue;
    const evidence = signals.slice(0, 150).map((signal) => ({ owner_id: ownerId, person_id: personId, relationship_snapshot_id: snapshot.id, source_type: signal.sourceType, source_id: signal.sourceId, evidence_type: signal.type, direction: signal.direction ?? null, observed_at: signal.observedAt, summary: signal.summary, signal: { score: signal.score }, weight: (signal.score - 50) / 100, confidence: signal.confidence }));
    if (evidence.length) await database.from("relationship_evidence").upsert(evidence, { onConflict: "owner_id,person_id,source_type,source_id,evidence_type", ignoreDuplicates: false });
    updated.push(category);
  }
  return { updated: updated.length, categories: updated };
}
