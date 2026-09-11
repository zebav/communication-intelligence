import { after, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { instagramConnector } from "@/lib/connectors/instagram";
import { findInstagramWebhookConnection, parseInstagramWebhook, validInstagramWebhookSignature } from "@/lib/connectors/instagram-webhook";
import { analyzeIncomingInstagramMessage } from "@/lib/connectors/instagram-intelligence";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  if (mode === "subscribe" && challenge && token && token === process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  return new NextResponse("Webhook verification failed.", { status: 403 });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const secret = process.env.INSTAGRAM_APP_SECRET ?? "";
  if (!validInstagramWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }
  const events = parseInstagramWebhook(rawBody);
  if (!events.length) return NextResponse.json({ received: true, imported: 0 });

  const database = createAdminClient();
  const { data: connections, error: connectionError } = await database.from("connections").select("id,owner_id,account_name,account_identifier,token_metadata").eq("provider", instagramConnector.id).eq("status", "connected");
  if (connectionError) {
    console.error("Instagram webhook connection lookup failed", {
      code: connectionError.code,
      message: connectionError.message,
      details: connectionError.details,
      hint: connectionError.hint,
    });
    return NextResponse.json({ error: "Instagram connections could not be loaded." }, { status: 500 });
  }
  let imported = 0;
  const analyses: Array<{ ownerId: string; conversationId: string; messageId: string }> = [];

  for (const event of events) {
    const connection = findInstagramWebhookConnection(connections ?? [], event.accountId);
    if (!connection) {
      console.warn("Instagram webhook account did not match a unique connection", {
        accountId: event.accountId,
        connectedAccounts: connections?.length ?? 0,
      });
      continue;
    }
    const identityKey = `instagram:${event.participantId}`;
    let { data: identity } = await database.from("identities").select("id,person_id").eq("owner_id", connection.owner_id).eq("source", "instagram").eq("external_identifier", identityKey).maybeSingle();
    if (!identity) {
      const { data: person, error: personError } = await database.from("people").insert({ owner_id: connection.owner_id, display_name: `Instagram contact ${event.participantId.slice(-6)}`, relationship_type: "unknown", entity_type: "person" }).select("id").single();
      if (personError || !person) continue;
      const identityResult = await database.from("identities").insert({ owner_id: connection.owner_id, person_id: person.id, source: "instagram", external_identifier: identityKey, metadata: { instagram_scoped_id: event.participantId, connection_id: connection.id }, verified_match: false, confidence: 0.7 }).select("id,person_id").single();
      if (identityResult.error || !identityResult.data) continue;
      identity = identityResult.data;
    }
    const conversationKey = `instagram:${connection.id}:${event.participantId}`;
    const { data: existingConversation } = await database.from("conversations").select("id").eq("owner_id", connection.owner_id).eq("source", "instagram").eq("external_conversation_id", conversationKey).maybeSingle();
    const conversationValues: Record<string, unknown> = { owner_id: connection.owner_id, person_id: identity.person_id, connection_id: connection.id, source: "instagram", external_conversation_id: conversationKey, title: `Instagram · ${connection.account_identifier ?? connection.account_name ?? "account"}`, conversation_type: "direct_message", last_message_at: event.message.sentAt, ...(event.message.direction === "in" ? { last_other_message_at: event.message.sentAt } : { last_user_message_at: event.message.sentAt }), updated_at: new Date().toISOString() };
    const conversationResult = existingConversation?.id
      ? await database.from("conversations").update(conversationValues).eq("id", existingConversation.id).eq("owner_id", connection.owner_id).select("id").single()
      : await database.from("conversations").insert(conversationValues).select("id").single();
    if (conversationResult.error || !conversationResult.data) continue;
    const { data: savedMessage, error: messageError } = await database.from("messages").upsert({ owner_id: connection.owner_id, conversation_id: conversationResult.data.id, external_message_id: event.message.externalId, direction: event.message.direction, sender_identity_id: event.message.direction === "in" ? identity.id : null, source: "instagram", body_text: event.message.body, sent_at: event.message.sentAt, attachment_count: event.message.attachmentCount, metadata: { ...event.message.providerMetadata, connection_id: connection.id }, processed_at: null }, { onConflict: "owner_id,source,external_message_id", ignoreDuplicates: true }).select("id").maybeSingle();
    if (!messageError && savedMessage) {
      imported += 1;
      if (event.message.direction === "in") analyses.push({ ownerId: connection.owner_id, conversationId: conversationResult.data.id, messageId: savedMessage.id });
    }
  }
  if (analyses.length) after(async () => { await Promise.allSettled(analyses.map((item) => analyzeIncomingInstagramMessage(item))); });
  return NextResponse.json({ received: true, imported });
}
