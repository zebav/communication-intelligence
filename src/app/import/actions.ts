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
  summary: z.string().trim().max(600).optional(), intent: z.string().trim().max(400).optional(), priorityScore: z.coerce.number().min(1).max(10).optional(),
  recommendedAction: z.string().trim().max(120).optional(), draftResponse: z.string().max(4000).optional(), draftTone: z.string().max(120).optional(),
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
  const participantKey = parsed.data.participantName.trim().toLocaleLowerCase();
  const identityKey = `import:${parsed.data.source}:${participantKey}`;
  const { data: knownIdentity } = await supabase.from("identities").select("person_id").eq("owner_id", user.id).eq("source", parsed.data.source).eq("external_identifier", identityKey).maybeSingle();
  const { data: people } = knownIdentity?.person_id ? { data: [{ id: knownIdentity.person_id }] } : await supabase.from("people").select("id").eq("owner_id", user.id).ilike("display_name", parsed.data.participantName).limit(1);
  let person = people?.[0];
  if (!person) {
    const result = await supabase.from("people").insert({ owner_id: user.id, display_name: parsed.data.participantName }).select("id").single();
    if (result.error || !result.data) return { error: "The person could not be saved." };
    person = result.data;
  }
  await supabase.from("identities").upsert({ owner_id: user.id, person_id: person.id, source: parsed.data.source, external_identifier: identityKey, metadata: { provider, account_label: parsed.data.accountLabel, inferred_from_import: true }, verified_match: false, confidence: 0.8 }, { onConflict: "owner_id,source,external_identifier" });
  const importId = crypto.randomUUID();
  const now = new Date();
  const sentTimes = lines.map((line, index) => validImportedDate(line.sentAt, new Date(now.getTime() - (lines.length - index) * 1000)));
  const { data: conversation, error: conversationError } = await supabase.from("conversations").insert({ owner_id: user.id, person_id: person.id, connection_id: connection.id, source: parsed.data.source, external_conversation_id: `manual-import-${importId}`, title: parsed.data.title, conversation_type: "imported", last_message_at: sentTimes.at(-1), summary: parsed.data.summary || lines.at(-1)?.body.slice(0, 300), priority_score: parsed.data.priorityScore, recommended_action: { action: parsed.data.recommendedAction, intent: parsed.data.intent, imported_analysis: true } }).select("id").single();
  if (conversationError || !conversation) return { error: "The imported conversation could not be saved." };
  const messages = lines.map((line, index) => ({ owner_id: user.id, conversation_id: conversation.id, external_message_id: `manual-import-${importId}-${index}`, direction: line.sender.toLowerCase() === parsed.data.ownerName.toLowerCase() ? "out" : "in", source: parsed.data.source, body_text: line.body, sent_at: sentTimes[index], processed_at: null, metadata: { provider, account_label: parsed.data.accountLabel, imported_sender: line.sender, owner_reviewed: true, ...(index === lines.length - 1 ? { ai_analysis: { summary: parsed.data.summary, intent: parsed.data.intent, priorityScore: parsed.data.priorityScore, recommendedAction: parsed.data.recommendedAction, draftResponse: parsed.data.draftResponse, draftTone: parsed.data.draftTone } } : {}) } }));
  const { data: savedMessages, error: messageError } = await supabase.from("messages").insert(messages).select("id");
  if (messageError) { await supabase.from("conversations").delete().eq("id", conversation.id).eq("owner_id", user.id); return { error: "The imported messages could not be saved." }; }
  const sourceMessageId = savedMessages?.at(-1)?.id;
  if (sourceMessageId && parsed.data.summary) await supabase.from("memories").insert({ owner_id: user.id, person_id: person.id, conversation_id: conversation.id, category: "conversation_context", content: `${parsed.data.summary}${parsed.data.intent ? ` Likely intent: ${parsed.data.intent}` : ""}`, confidence: 0.8, source_message_id: sourceMessageId, user_verified: false });
  await supabase.from("audit_logs").insert({ owner_id: user.id, actor_id: user.id, action: "conversation.imported", object_type: "conversation", object_id: conversation.id, source: parsed.data.source, actor_type: "user", new_value: { provider, account_label: parsed.data.accountLabel, message_count: messages.length } });
  revalidatePath("/");
  return { success: `${messages.length} messages imported from ${parsed.data.accountLabel}.` };
}
