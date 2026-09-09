"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { positiveOutcomeRule } from "@/lib/outcomes";
import { saveLearningSuggestion } from "@/lib/learning-feedback";

const outcomeSchema = z.object({
  outcomeId: z.string().uuid(),
  status: z.enum(["waiting", "reply_received", "resolved", "follow_up_needed", "unknown"]),
  rating: z.enum(["successful", "neutral", "unsuccessful"]).nullable(),
  desiredOutcome: z.string().trim().min(1).max(300),
});

export async function reviewCommunicationOutcome(input: { outcomeId: string; status: "waiting" | "reply_received" | "resolved" | "follow_up_needed" | "unknown"; rating: "successful" | "neutral" | "unsuccessful" | null; desiredOutcome: string }) {
  const parsed = outcomeSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the result and desired outcome." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return { error: "Two-factor authentication is required." };
  const { data: outcome } = await supabase.from("communication_outcomes")
    .select("id,person_id,conversation_id,status,owner_rating,trigger_message_id,people(display_name,relationship_type),messages!communication_outcomes_trigger_message_id_fkey(body_text)")
    .eq("id", parsed.data.outcomeId).eq("owner_id", user.id).maybeSingle();
  if (!outcome) return { error: "This result is no longer available." };
  const { error } = await supabase.from("communication_outcomes").update({ status: parsed.data.status, owner_rating: parsed.data.rating, desired_outcome: parsed.data.desiredOutcome, user_confirmed: true, updated_at: new Date().toISOString() }).eq("id", outcome.id).eq("owner_id", user.id);
  if (error) return { error: "The result could not be saved." };
  const person = Array.isArray(outcome.people) ? outcome.people[0] : outcome.people;
  const triggerMessage = Array.isArray(outcome.messages) ? outcome.messages[0] : outcome.messages;
  if (parsed.data.rating === "successful" && triggerMessage?.body_text) {
    const replyWordCount = triggerMessage.body_text.trim().split(/\s+/).filter(Boolean).length;
    const proposedRule = positiveOutcomeRule({ personName: person?.display_name ?? "this person", relationship: person?.relationship_type, replyWordCount });
    await saveLearningSuggestion(supabase, { ownerId: user.id, personId: outcome.person_id, conversationId: outcome.conversation_id, source: "email", signalType: "outcome_confirmed", observation: `You marked the outcome after this ${replyWordCount}-word reply as successful.`, proposedRule, evidence: { outcome_id: outcome.id, response_status: parsed.data.status, reply_word_count: replyWordCount }, confidence: 0.7 });
  }
  await supabase.from("audit_logs").insert({ owner_id: user.id, actor_id: user.id, action: "outcome.reviewed", object_type: "communication_outcome", object_id: outcome.id, source: "email", actor_type: "user", previous_value: { status: outcome.status, rating: outcome.owner_rating }, new_value: { status: parsed.data.status, rating: parsed.data.rating } });
  revalidatePath("/");
  return { success: true };
}

export async function deleteCommunicationOutcome(outcomeId: string) {
  const parsed = z.string().uuid().safeParse(outcomeId);
  if (!parsed.success) return { error: "The result could not be identified." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return { error: "Two-factor authentication is required." };
  const { error } = await supabase.from("communication_outcomes").delete().eq("id", parsed.data).eq("owner_id", user.id);
  if (error) return { error: "The result could not be deleted." };
  revalidatePath("/");
  return { success: true };
}
