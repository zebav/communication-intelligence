import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mediaContextForMessage } from "@/lib/media/context";
import type { Plan } from "./model";

export type DecisionContextItem = {
  kind: "person" | "relationship" | "learning" | "media" | "time";
  source: "contact" | "relationship_intelligence" | "learning" | "vault" | "system";
  summary: string;
  verified: boolean;
  confidence?: number;
  observedAt?: string;
};

export type DecisionContext = {
  version: "v1";
  preparedAt: string;
  items: DecisionContextItem[];
};

/**
 * Gather the smallest useful context for one decision. This intentionally
 * reads no personal-vault values: sensitive facts must be selected through a
 * specific, authorised task requirement rather than bulk-decrypted for AI.
 */
export async function retrieveDecisionContext(db: SupabaseClient, ownerId: string, plan: Plan): Promise<DecisionContext> {
  const personId = plan.evidence.personId;
  const [personResult, snapshotsResult, learningResult, media] = await Promise.all([
    personId
      ? db.from("people").select("display_name,organization,relationship_type,relationship_summary,manual_priority,last_contact_at").eq("owner_id", ownerId).eq("id", personId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    personId
      ? db.from("relationship_snapshots").select("category,ranking_score,trend,confidence,explanation,last_analyzed_at").eq("owner_id", ownerId).eq("person_id", personId).order("snapshot_date", { ascending: false }).limit(8)
      : Promise.resolve({ data: [], error: null }),
    db.from("learning_signals").select("proposed_rule,confidence,created_at").eq("owner_id", ownerId).eq("status", "approved").or(`person_id.is.null,person_id.eq.${personId ?? "00000000-0000-0000-0000-000000000000"}`).limit(12),
    mediaContextForMessage(db, ownerId, plan.evidence.messageId),
  ]);
  const items: DecisionContextItem[] = [{
    kind: "time", source: "system", summary: `Aktuell tidpunkt: ${new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Stockholm" }).format(new Date())} (Europe/Stockholm).`, verified: true, observedAt: new Date().toISOString(),
  }];
  const person = personResult.data;
  if (!personResult.error && person) {
    const detail = [person.organization, person.relationship_type && person.relationship_type !== "unknown" ? person.relationship_type : "", person.relationship_summary].filter(Boolean).join(" · ");
    items.push({ kind: "person", source: "contact", summary: `${person.display_name}${detail ? `: ${detail}` : ""}`, verified: Boolean(person.relationship_type && person.relationship_type !== "unknown"), observedAt: person.last_contact_at ?? undefined });
  }
  if (!snapshotsResult.error) {
    const seen = new Set<string>();
    for (const snapshot of snapshotsResult.data ?? []) {
      if (seen.has(snapshot.category)) continue;
      seen.add(snapshot.category);
      items.push({ kind: "relationship", source: "relationship_intelligence", summary: `${snapshot.category}: relationens prioritet ${Math.round(Number(snapshot.ranking_score ?? 0))}/100${snapshot.trend ? `, trend ${snapshot.trend}` : ""}. ${snapshot.explanation ?? ""}`.trim(), verified: false, confidence: Number(snapshot.confidence ?? 0), observedAt: snapshot.last_analyzed_at ?? undefined });
    }
  }
  if (!learningResult.error) for (const rule of learningResult.data ?? []) items.push({ kind: "learning", source: "learning", summary: String(rule.proposed_rule ?? "").slice(0, 700), verified: true, confidence: Number(rule.confidence ?? 0), observedAt: rule.created_at ?? undefined });
  for (const asset of media.filter((item) => item.responseRelevance !== "none").slice(0, 4)) items.push({ kind: "media", source: "vault", summary: `${asset.filename}: ${asset.summary || asset.extractedText.slice(0, 600)}`.slice(0, 1_200), verified: false, observedAt: plan.evidence.sentAt });
  return { version: "v1", preparedAt: new Date().toISOString(), items: items.filter((item) => item.summary.trim()) };
}

export function decisionContextPrompt(context: DecisionContext) {
  return context.items.filter((item) => item.kind !== "time" || context.items.length === 1).map((item) => `[${item.source}${item.verified ? ", verifierat" : ", bedömning"}] ${item.summary}`).join("\n");
}
