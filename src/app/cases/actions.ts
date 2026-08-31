"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type CreateCaseState = { error?: string; success?: string } | undefined;

const createCaseSchema = z.object({
  personName: z.string().trim().min(1, "Enter the person's name.").max(120),
  title: z.string().trim().min(1, "Enter a subject.").max(200),
  source: z.enum(["email", "instagram", "whatsapp", "messenger", "tinder", "tiktok", "linkedin", "manual"]),
  message: z.string().trim().min(1, "Paste or write the communication.").max(20_000),
});

export async function createCommunicationCase(_: CreateCaseState, formData: FormData): Promise<CreateCaseState> {
  const parsed = createCaseSchema.safeParse({ personName: formData.get("personName"), title: formData.get("title"), source: formData.get("source"), message: formData.get("message") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!assurance || assurance.currentLevel !== "aal2") return { error: "Two-factor authentication is required." };

  const { data: existingPerson, error: lookupError } = await supabase.from("people").select("id").ilike("display_name", parsed.data.personName).limit(1).maybeSingle();
  if (lookupError) return { error: "The person could not be checked." };

  let person = existingPerson;
  let createdPerson = false;
  if (!person) {
    const { data: newPerson, error: personError } = await supabase.from("people").insert({ owner_id: user.id, display_name: parsed.data.personName }).select("id").single();
    if (personError || !newPerson) return { error: "The person could not be saved." };
    person = newPerson;
    createdPerson = true;
  }

  const { data: conversation, error: conversationError } = await supabase.from("conversations").insert({ owner_id: user.id, person_id: person.id, source: parsed.data.source, title: parsed.data.title, last_message_at: new Date().toISOString(), summary: parsed.data.message.slice(0, 300) }).select("id").single();
  if (conversationError || !conversation) {
    if (createdPerson) await supabase.from("people").delete().eq("id", person.id);
    return { error: "The communication case could not be saved." };
  }

  const { error: messageError } = await supabase.from("messages").insert({ owner_id: user.id, conversation_id: conversation.id, external_message_id: `manual-${crypto.randomUUID()}`, direction: "in", source: parsed.data.source, body_text: parsed.data.message, sent_at: new Date().toISOString() });
  if (messageError) {
    await supabase.from("conversations").delete().eq("id", conversation.id);
    if (createdPerson) await supabase.from("people").delete().eq("id", person.id);
    return { error: "The message could not be saved." };
  }

  revalidatePath("/");
  return { success: "Communication case saved." };
}
