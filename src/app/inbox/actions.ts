"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { emailPriority, recommendedEmailAction } from "@/lib/connectors/email-classification";
import { createClient } from "@/lib/supabase/server";

const categories = ["Critical", "Action Required", "Business", "Customer", "Personal", "Booking / Travel", "Financial", "Legal", "Receipt / Invoice", "Newsletter", "Marketing", "Notification", "Spam", "Information Only"] as const;
const correctionSchema = z.object({ messageId: z.string().uuid(), conversationId: z.string().uuid(), classification: z.enum(categories) });

export async function correctEmailClassification(input: { messageId: string; conversationId: string; classification: string }) {
  const parsed = correctionSchema.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid category." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return { error: "Two-factor authentication is required." };
  const priority = emailPriority(parsed.data.classification);
  const action = recommendedEmailAction(parsed.data.classification);
  const { error: messageError } = await supabase.from("messages").update({ classification: parsed.data.classification, importance_score: priority, processed_at: new Date().toISOString() })
    .eq("id", parsed.data.messageId).eq("owner_id", user.id).eq("source", "email");
  if (messageError) return { error: "The category could not be saved." };
  const { error: conversationError } = await supabase.from("conversations").update({ priority_score: priority, recommended_action: { action, reason: `Category corrected by owner: ${parsed.data.classification}` }, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.conversationId).eq("owner_id", user.id).eq("source", "email");
  if (conversationError) return { error: "The recommendation could not be updated." };
  revalidatePath("/");
  return { success: true };
}
