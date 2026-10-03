"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { relationshipCategories } from "@/lib/relationship-intelligence";
import { refreshRelationshipIntelligence } from "@/lib/relationship-intelligence-service";

const feedbackSchema = z.object({
  personId: z.string().uuid(),
  category: z.enum(relationshipCategories),
  decision: z.enum(["confirm", "reject", "more_important", "less_important"]),
  note: z.string().trim().max(500).optional(),
});

export async function saveRelationshipFeedback(input: z.infer<typeof feedbackSchema>) {
  const parsed = feedbackSchema.safeParse(input);
  if (!parsed.success) return { error: "Kontrollera relationsuppgiften." };
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) return { error: "Din session har gått ut." };
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return { error: "Tvåfaktorsautentisering krävs." };
  const types = { confirm: "category_confirmed", reject: "category_rejected", more_important: "importance_adjusted", less_important: "importance_adjusted" } as const;
  const effective = parsed.data.decision === "confirm" ? { category: parsed.data.category, confirmed: true } : parsed.data.decision === "reject" ? { category: parsed.data.category, rejected: true } : { priority_adjustment: parsed.data.decision === "more_important" ? 10 : -10 };
  const { error } = await database.from("relationship_feedback").insert({ owner_id: user.id, person_id: parsed.data.personId, category: parsed.data.category, feedback_type: types[parsed.data.decision], owner_correction: { decision: parsed.data.decision }, effective_state: effective, note: parsed.data.note || null });
  if (error) return { error: "Korrigeringen kunde inte sparas." };
  await database.from("audit_logs").insert({ owner_id: user.id, actor_id: user.id, action: "relationship.feedback_saved", object_type: "person", object_id: parsed.data.personId, actor_type: "user", new_value: { category: parsed.data.category, ...effective } });
  await refreshRelationshipIntelligence(database, user.id, parsed.data.personId).catch(() => undefined);
  revalidatePath("/relationships");
  revalidatePath(`/contacts/${parsed.data.personId}`);
  return { success: true };
}

export async function startRelationshipBackfill() {
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) return { error: "Din session har gått ut." };
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return { error: "Tvåfaktorsautentisering krävs." };
  const { data: active } = await database.from("relationship_backfill_jobs").select("id,status").eq("owner_id", user.id).in("status", ["pending", "running", "paused"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (active) return { success: true, alreadyActive: true };
  // Freeze the denominator when the job starts. New contacts can be analyzed
  // incrementally later, but must not make an in-progress percentage jump.
  const { count, error: countError } = await database.from("people")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", user.id)
    .eq("entity_type", "person")
    .or("relationship_status.is.null,relationship_status.neq.merged");
  if (countError) return { error: "Kontakterna kunde inte räknas inför den historiska analysen." };
  const { error } = await database.from("relationship_backfill_jobs").insert({
    owner_id: user.id,
    status: "pending",
    current_stage: "queued",
    total_people: count ?? 0,
    cost_budget_cents: 0,
  });
  if (error) return { error: "Historisk analys kunde inte startas." };
  revalidatePath("/relationships");
  return { success: true, alreadyActive: false };
}
