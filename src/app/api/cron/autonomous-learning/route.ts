import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { ownerIdFromCronHeaders } from "@/lib/cron-owner";
import { decideAutonomousLearning, repetitionsFromEvidence } from "@/lib/autonomous-learning";
import { logOperation } from "@/lib/observability";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type LearningRow = {
  id: string;
  owner_id: string;
  signal_type: string;
  confidence: number | null;
  evidence: unknown;
  sensitivity: "personal" | "sensitive" | "restricted" | null;
};

/**
 * Background reconciliation for the existing learning ledger. It is purposely
 * conservative: it only promotes repeated reply-style observations and never
 * sends, books, deletes or changes a connection.
 */
export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  if (!isAuthorizedCron(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const database = createAdminClient();
  const ownerId = ownerIdFromCronHeaders(request.headers);
  let query = database
    .from("learning_signals")
    .select("id,owner_id,signal_type,confidence,evidence,sensitivity")
    .eq("status", "suggested")
    .eq("learning_mode", "review_required")
    .order("updated_at", { ascending: true })
    .limit(80);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { data, error } = await query;
  if (error) {
    logOperation({ route: "/api/cron/autonomous-learning", operation: "autonomous_learning", outcome: "failed", durationMs: Date.now() - startedAt, requestId: request.headers.get("x-vercel-id"), traceId: request.headers.get("x-solvani-trace-id"), error: "learning_signals_unavailable" });
    return NextResponse.json({ error: "Learning ledger is unavailable." }, { status: 503 });
  }

  const candidates = (data ?? []) as LearningRow[];
  let promoted = 0;
  for (const item of candidates) {
    const decision = decideAutonomousLearning({
      signalType: item.signal_type,
      confidence: Number(item.confidence ?? 0),
      repetitions: repetitionsFromEvidence(item.evidence),
      sensitivity: item.sensitivity ?? "personal",
    });
    if (!decision.shouldAutoApply) continue;
    const now = new Date().toISOString();
    const evidence = item.evidence && typeof item.evidence === "object" && !Array.isArray(item.evidence) ? item.evidence as Record<string, unknown> : {};
    const { data: updated, error: updateError } = await database.from("learning_signals").update({
      status: "approved",
      learning_mode: "automatic",
      fact_state: decision.factState,
      autonomy_level: decision.autonomyLevel,
      auto_applied_at: now,
      last_validated_at: now,
      evidence: { ...evidence, autonomy_reason: decision.reason, policy_version: 1 },
      updated_at: now,
    }).eq("id", item.id).eq("owner_id", item.owner_id).eq("status", "suggested").select("id").maybeSingle();
    if (updateError || !updated) continue;
    promoted += 1;
    await database.from("audit_logs").insert({
      owner_id: item.owner_id,
      actor_id: null,
      actor_type: "system",
      action: "learning.auto_applied",
      object_type: "learning_signal",
      object_id: item.id,
      source: "autonomous_learning",
      new_value: { signal_type: item.signal_type, autonomy_level: 1, policy_version: 1 },
    });
  }

  logOperation({ route: "/api/cron/autonomous-learning", operation: "autonomous_learning", outcome: "completed", durationMs: Date.now() - startedAt, requestId: request.headers.get("x-vercel-id"), traceId: request.headers.get("x-solvani-trace-id"), counts: { scanned: candidates.length, auto_applied: promoted, requires_review: candidates.length - promoted } });
  return NextResponse.json({ ok: true, scanned: candidates.length, autoApplied: promoted, requiresReview: candidates.length - promoted }, { headers: { "Cache-Control": "no-store" } });
}
