"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { parseImportedConversation, validImportedDate } from "@/lib/connectors/manual-import";

export type ImportConversationState = { error?: string; success?: string } | undefined;
const schema = z.object({
  source: z.enum(["email", "imessage", "instagram", "whatsapp", "messenger", "tinder", "tiktok", "linkedin", "manual"]),
  accountLabel: z.string().trim().min(1).max(120), participantName: z.string().trim().min(1).max(120),
  ownerName: z.string().trim().min(1).max(120), title: z.string().trim().min(1).max(200),
  transcript: z.string().trim().min(1).max(500_000), confirmed: z.literal("yes"),
});

export async function importConversation(_: ImportConversationState, formData: FormData): Promise<ImportConversationState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Review the import fields." };
  const lines = parseImportedConversation(parsed.data.transcript).slice(0, 1000);
  if (!lines.length) return { error: "No messages could be found in the import." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return { error: "Two-factor authentication is required." };

  const provider = `manual-import:${parsed.data.source}`;
  const identifier = parsed.data.accountLabel.toLowerCase();
  let { data: connection } = await supabase.from("connections").select("id").eq("owner_id", user.id).eq("provider", provider).eq("account_identifier", identifier).maybeSingle();
  if (!connection) {
    const result = await supabase.from("connections").insert({ owner_id: user.id, provider, source: parsed.data.source, account_name: parsed.data.accountLabel, account_identifier: identifier, status: "connected", health_status: "manual", capabilities: { fullSync: true, sendWithApproval: false }, scopes: [] }).select("id").single();
    if (result.error || !result.data) return { error: "The account label could not be saved." };
    connection = result.data;
  }
  const { data: people } = await supabase.from("people").select("id").eq("owner_id", user.id).ilike("display_name", parsed.data.participantName).limit(1);
  let person = people?.[0];
  if (!person) {
    const result = await supabase.from("people").insert({ owner_id: user.id, display_name: parsed.data.participantName }).select("id").single();
    if (result.error || !result.data) return { error: "The person could not be saved." };
    person = result.data;
  }
  const importId = crypto.randomUUID();
  const now = new Date();
  const sentTimes = lines.map((line, index) => validImportedDate(line.sentAt, new Date(now.getTime() - (lines.length - index) * 1000)));
  const { data: conversation, error: conversationError } = await supabase.from("conversations").insert({ owner_id: user.id, person_id: person.id, connection_id: connection.id, source: parsed.data.source, external_conversation_id: `manual-import-${importId}`, title: parsed.data.title, conversation_type: "imported", last_message_at: sentTimes.at(-1), summary: lines.at(-1)?.body.slice(0, 300) }).select("id").single();
  if (conversationError || !conversation) return { error: "The imported conversation could not be saved." };
  const messages = lines.map((line, index) => ({ owner_id: user.id, conversation_id: conversation.id, external_message_id: `manual-import-${importId}-${index}`, direction: line.sender.toLowerCase() === parsed.data.ownerName.toLowerCase() ? "out" : "in", source: parsed.data.source, body_text: line.body, sent_at: sentTimes[index], processed_at: null, metadata: { provider, account_label: parsed.data.accountLabel, imported_sender: line.sender, owner_reviewed: true } }));
  const { error: messageError } = await supabase.from("messages").insert(messages);
  if (messageError) { await supabase.from("conversations").delete().eq("id", conversation.id).eq("owner_id", user.id); return { error: "The imported messages could not be saved." }; }
  await supabase.from("audit_logs").insert({ owner_id: user.id, actor_id: user.id, action: "conversation.imported", object_type: "conversation", object_id: conversation.id, source: parsed.data.source, actor_type: "user", new_value: { provider, account_label: parsed.data.accountLabel, message_count: messages.length } });
  revalidatePath("/");
  return { success: `${messages.length} messages imported from ${parsed.data.accountLabel}.` };
}
