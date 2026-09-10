"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { emailPriority, recommendedEmailAction } from "@/lib/connectors/email-classification";
import { senderRelevance } from "@/lib/sender-intelligence";
import { relationshipTypes } from "@/lib/relationship-types";

const personSchema = z.object({
  personId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  organization: z.string().trim().max(200),
  relationshipType: z.enum(relationshipTypes),
  notes: z.string().trim().max(2000),
  relationshipSummary: z.string().trim().max(1000),
  manualPriority: z.number().min(1).max(10),
});

export async function savePersonIntelligence(input: { personId: string; name: string; organization: string; relationshipType: string; notes: string; relationshipSummary: string; manualPriority: number }) {
  const parsed = personSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the person's name, relationship, and priority." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return { error: "Two-factor authentication is required." };
  const { data: previous } = await supabase.from("people").select("display_name,organization,relationship_type,notes,relationship_summary,manual_priority,email_handling_rule").eq("id", parsed.data.personId).eq("owner_id", user.id).maybeSingle();
  if (!previous) return { error: "The selected person could not be loaded." };
  const values = { display_name: parsed.data.name, organization: parsed.data.organization || null, relationship_type: parsed.data.relationshipType, notes: parsed.data.notes || null, relationship_summary: parsed.data.relationshipSummary || null, manual_priority: parsed.data.manualPriority, sender_preferences_verified: true, updated_at: new Date().toISOString() };
  const { error } = await supabase.from("people").update(values).eq("id", parsed.data.personId).eq("owner_id", user.id);
  if (error) return { error: "The person information could not be saved." };
  const { data: conversations } = await supabase.from("conversations").select("id,recommended_action,messages(classification,sent_at,direction)").eq("owner_id", user.id).eq("person_id", parsed.data.personId).eq("source", "email");
  for (const conversation of conversations ?? []) {
    const latest = [...(conversation.messages ?? [])].filter((message) => message.direction === "in").sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))[0];
    if (!latest) continue;
    const classification = latest.classification ?? "Information Only";
    const handlingRule = previous.email_handling_rule === "always_priority" || previous.email_handling_rule === "low_priority" ? previous.email_handling_rule : "normal";
    const relevance = senderRelevance({ basePriority: emailPriority(classification), relationshipType: parsed.data.relationshipType, manualPriority: parsed.data.manualPriority, handlingRule });
    const recommendation = conversation.recommended_action && typeof conversation.recommended_action === "object" && !Array.isArray(conversation.recommended_action) ? conversation.recommended_action as Record<string, unknown> : {};
    await supabase.from("conversations").update({ priority_score: relevance.score, recommended_action: { ...recommendation, action: recommendedEmailAction(classification), relevance_reasons: relevance.reasons }, updated_at: new Date().toISOString() }).eq("id", conversation.id).eq("owner_id", user.id);
  }
  await supabase.from("audit_logs").insert({ owner_id: user.id, actor_id: user.id, action: "person.intelligence_updated", object_type: "person", object_id: parsed.data.personId, actor_type: "user", previous_value: previous, new_value: values });
  revalidatePath("/");
  return { success: true };
}
