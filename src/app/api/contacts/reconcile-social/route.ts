import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveOrCreateChannelPerson } from "@/lib/connectors/person-resolution";

function participantFromConversation(source: "instagram" | "whatsapp", externalConversationId: string | null) {
  const value = externalConversationId?.trim() ?? "";
  if (!value) return "";
  const parts = value.split(":").filter(Boolean);
  if (parts[0] === source && parts.length >= 2) return parts.at(-1) ?? "";
  return value;
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) return NextResponse.json({ error: "Your session has expired. Sign in again." }, { status: 401 });
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.json({ error: "Two-factor authentication is required." }, { status: 403 });

  const { data: conversations, error } = await database
    .from("conversations")
    .select("id,person_id,source,external_conversation_id,last_message_at,connection_id")
    .eq("owner_id", user.id)
    .in("source", ["instagram", "whatsapp"])
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(2000);
  if (error) return NextResponse.json({ error: "Social conversations could not be loaded." }, { status: 500 });

  let checked = 0;
  let createdPeople = 0;
  let createdIdentities = 0;
  let relinkedConversations = 0;
  let relinkedMessages = 0;
  let skipped = 0;

  for (const conversation of conversations ?? []) {
    const source = conversation.source === "instagram" || conversation.source === "whatsapp" ? conversation.source : null;
    if (!source) continue;
    const participantId = participantFromConversation(source, conversation.external_conversation_id);
    if (!participantId) { skipped += 1; continue; }
    checked += 1;
    try {
      const identityKey = `${source}:${participantId}`;
      const resolved = await resolveOrCreateChannelPerson({
        database,
        ownerId: user.id,
        source,
        externalIdentifier: identityKey,
        preferredPersonId: conversation.person_id,
        username: source === "whatsapp" ? participantId : null,
        connectionId: conversation.connection_id,
        confidence: conversation.person_id ? 1 : 0.65,
        contactAt: conversation.last_message_at ?? undefined,
        identityMetadata: source === "whatsapp" ? { phone_number: participantId, reconciled_from_conversation: true } : { instagram_scoped_id: participantId, reconciled_from_conversation: true },
      });
      if (resolved.createdPerson) createdPeople += 1;
      if (resolved.createdIdentity) createdIdentities += 1;

      if (conversation.person_id !== resolved.personId) {
        const { error: conversationError } = await database.from("conversations").update({ person_id: resolved.personId, updated_at: new Date().toISOString() }).eq("id", conversation.id).eq("owner_id", user.id);
        if (conversationError) throw conversationError;
        relinkedConversations += 1;
      }

      const { data: unlinkedMessages, error: messageLookupError } = await database
        .from("messages")
        .select("id")
        .eq("owner_id", user.id)
        .eq("conversation_id", conversation.id)
        .eq("source", source)
        .eq("direction", "in")
        .is("sender_identity_id", null);
      if (messageLookupError) throw messageLookupError;
      if (unlinkedMessages?.length) {
        const ids = unlinkedMessages.map((item) => item.id);
        const { error: messageUpdateError } = await database.from("messages").update({ sender_identity_id: resolved.identityId }).eq("owner_id", user.id).in("id", ids);
        if (messageUpdateError) throw messageUpdateError;
        relinkedMessages += ids.length;
      }
    } catch (caught) {
      skipped += 1;
      console.error("Social contact reconciliation failed", { conversationId: conversation.id, source, reason: caught instanceof Error ? caught.message : "unknown" });
    }
  }

  await database.from("audit_logs").insert({
    owner_id: user.id,
    actor_id: user.id,
    actor_type: "user",
    action: "contacts.social_reconciled",
    object_type: "contacts",
    source: "social",
    new_value: { checked, created_people: createdPeople, created_identities: createdIdentities, relinked_conversations: relinkedConversations, relinked_messages: relinkedMessages, skipped },
  });

  return NextResponse.json({ success: true, checked, createdPeople, createdIdentities, relinkedConversations, relinkedMessages, skipped });
}
