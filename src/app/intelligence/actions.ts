"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const reviewSchema = z.object({ signalId: z.string().uuid(), decision: z.enum(["approve", "dismiss", "delete"]), proposedRule: z.string().trim().min(1).max(500).optional() });

export async function reviewLearningSignal(input: { signalId: string; decision: "approve" | "dismiss" | "delete"; proposedRule?: string }) {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success || (parsed.data.decision === "approve" && !parsed.data.proposedRule)) return { error: "Check the learning rule and try again." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return { error: "Two-factor authentication is required." };
  const { data: signal } = await supabase.from("learning_signals").select("id,status,signal_type,proposed_rule").eq("id", parsed.data.signalId).eq("owner_id", user.id).maybeSingle();
  if (!signal) return { error: "This learning signal is no longer available." };
  const nextStatus = parsed.data.decision === "approve" ? "approved" : "dismissed";
  const { error } = parsed.data.decision === "delete"
    ? await supabase.from("learning_signals").delete().eq("id", signal.id).eq("owner_id", user.id)
    : await supabase.from("learning_signals").update({ status: nextStatus, proposed_rule: parsed.data.proposedRule ?? signal.proposed_rule, updated_at: new Date().toISOString() }).eq("id", signal.id).eq("owner_id", user.id);
  if (error) return { error: "The learning decision could not be saved." };
  const auditAction = { approve: "learning.approved", dismiss: "learning.dismissed", delete: "learning.deleted" }[parsed.data.decision];
  await supabase.from("audit_logs").insert({ owner_id: user.id, actor_id: user.id, action: auditAction, object_type: "learning_signal", object_id: signal.id, source: "email", actor_type: "user", previous_value: { status: signal.status }, new_value: { decision: parsed.data.decision, signal_type: signal.signal_type } });
  revalidatePath("/");
  return { success: true };
}
