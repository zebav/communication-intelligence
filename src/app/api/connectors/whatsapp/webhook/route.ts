import { after, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { whatsappConnector } from "@/lib/connectors/whatsapp";
import { findWhatsAppWebhookConnection, parseWhatsAppWebhook, validWhatsAppWebhookSignature } from "@/lib/connectors/whatsapp-webhook";
import { analyzeIncomingWhatsAppMessage } from "@/lib/connectors/whatsapp-intelligence";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  if (mode === "subscribe" && challenge && token && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  return new NextResponse("Webhook verification failed.", { status: 403 });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const secret = process.env.WHATSAPP_APP_SECRET || process.env.INSTAGRAM_APP_SECRET || "";
  if (!validWhatsAppWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"), secret)) return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  const events = parseWhatsAppWebhook(rawBody);
  if (!events.messages.length && !events.statuses.length) return NextResponse.json({ received: true, imported: 0 });
  const database = createAdminClient();
  const { data: connections, error } = await database.from("connections").select("id,owner_id,account_name,account_identifier,token_metadata").eq("provider", whatsappConnector.id).eq("status", "connected");
  if (error) return NextResponse.json({ error: "WhatsApp connections could not be loaded." }, { status: 500 });
  for (const status of events.statuses) {
    const connection = findWhatsAppWebhookConnection(connections ?? [], status.phoneNumberId);
    if (!connection) continue;
    const { data: existing } = await database.from("messages").select("id,metadata").eq("owner_id", connection.owner_id).eq("source", "whatsapp").eq("external_message_id", status.externalMessageId).maybeSingle();
    if (!existing) continue;
    const metadata = existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata) ? existing.metadata : {};
    await database.from("messages").update({ metadata: { ...metadata, delivery_status: status.status, delivery_status_at: status.timestamp ?? new Date().toISOString(), delivery_errors: status.errors ?? null } }).eq("id", existing.id).eq("owner_id", connection.owner_id);
  }
  let imported = 0;
  const analyses: Array<{ ownerId: string; conversationId: string; messageId: string }> = [];
  for (const event of events.messages) {
    const connection = findWhatsAppWebhookConnection(connections ?? [], event.phoneNumberId);
    if (!connection) continue;
    const identityKey = `whatsapp:${event.participantId}`;
    let { data: identity } = await database.from("identities").select("id,person_id").eq("owner_id", connection.owner_id).eq("source", "whatsapp").eq("external_identifier", identityKey).maybeSingle();
    if (!identity) {
      const { data: person } = await database.from("people").insert({ owner_id: connection.owner_id, display_name: event.participantName || `WhatsApp contact ${event.participantId.slice(-6)}`, relationship_type: "unknown", entity_type: "person" }).select("id").single();
      if (!person) continue;
      const created = await database.from("identities").insert({ owner_id: connection.owner_id, person_id: person.id, source: "whatsapp", external_identifier: identityKey, username: event.participantId, metadata: { phone_number: event.participantId, connection_id: connection.id }, verified_match: false, confidence: 0.8 }).select("id,person_id").single();
      if (!created.data) continue;
      identity = created.data;
    } else if (event.participantName) {
      await database.from("people").update({ display_name: event.participantName, updated_at: new Date().toISOString() }).eq("id", identity.person_id).eq("owner_id", connection.owner_id).like("display_name", "WhatsApp contact %");
    }
    const conversationKey = `whatsapp:${connection.id}:${event.participantId}`;
    const { data: existingConversation } = await database.from("conversations").select("id").eq("owner_id", connection.owner_id).eq("source", "whatsapp").eq("external_conversation_id", conversationKey).maybeSingle();
    const values = { owner_id: connection.owner_id, person_id: identity.person_id, connection_id: connection.id, source: "whatsapp", external_conversation_id: conversationKey, title: `WhatsApp · ${connection.account_identifier ?? connection.account_name ?? "account"}`, conversation_type: "chat", last_message_at: event.message.sentAt, last_other_message_at: event.message.sentAt, updated_at: new Date().toISOString() };
    const conversation = existingConversation?.id ? await database.from("conversations").update(values).eq("id", existingConversation.id).eq("owner_id", connection.owner_id).select("id").single() : await database.from("conversations").insert(values).select("id").single();
    if (!conversation.data) continue;
    const saved = await database.from("messages").upsert({ owner_id: connection.owner_id, conversation_id: conversation.data.id, external_message_id: event.message.externalId, direction: "in", sender_identity_id: identity.id, source: "whatsapp", body_text: event.message.body, sent_at: event.message.sentAt, attachment_count: event.message.attachmentCount, metadata: { ...event.message.providerMetadata, connection_id: connection.id }, processed_at: null }, { onConflict: "owner_id,source,external_message_id", ignoreDuplicates: true }).select("id").maybeSingle();
    if (saved.data) { imported += 1; analyses.push({ ownerId: connection.owner_id, conversationId: conversation.data.id, messageId: saved.data.id }); }
  }
  if (analyses.length) after(async () => { await Promise.allSettled(analyses.map(analyzeIncomingWhatsAppMessage)); });
  return NextResponse.json({ received: true, imported, statusUpdates: events.statuses.length });
}
