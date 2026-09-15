import { after, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { whatsappConnector } from "@/lib/connectors/whatsapp";
import { findWhatsAppWebhookConnection, parseWhatsAppWebhook, validWhatsAppWebhookSignature } from "@/lib/connectors/whatsapp-webhook";
import { analyzeIncomingWhatsAppMessage } from "@/lib/connectors/whatsapp-intelligence";
import { resolveOrCreateChannelPerson } from "@/lib/connectors/person-resolution";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  if (mode === "subscribe" && challenge && token && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  return new NextResponse("Webhook verification failed.", { status: 403 });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const secret = process.env.WHATSAPP_APP_SECRET || process.env.INSTAGRAM_APP_SECRET || "";
  if (!validWhatsAppWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"), secret)) {
    console.warn("WhatsApp webhook rejected: invalid signature");
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  const events = parseWhatsAppWebhook(rawBody);
  if (!events.messages.length && !events.statuses.length) {
    console.info("WhatsApp webhook received without message/status events");
    return NextResponse.json({ received: true, imported: 0, parsedMessages: 0, parsedStatuses: 0 });
  }

  const database = createAdminClient();
  const { data: connections, error: connectionError } = await database
    .from("connections")
    .select("id,owner_id,account_name,account_identifier,token_metadata")
    .eq("provider", whatsappConnector.id)
    .eq("status", "connected");
  if (connectionError) {
    console.error("WhatsApp webhook connection lookup failed", {
      code: connectionError.code,
      message: connectionError.message,
      details: connectionError.details,
      hint: connectionError.hint,
    });
    return NextResponse.json({ error: "WhatsApp connections could not be loaded." }, { status: 500 });
  }

  let statusUpdates = 0;
  let unmatchedStatuses = 0;
  let failedStatuses = 0;
  for (const status of events.statuses) {
    const connection = findWhatsAppWebhookConnection(connections ?? [], status.phoneNumberId);
    if (!connection) {
      unmatchedStatuses += 1;
      console.warn("WhatsApp status did not match a connected phone number", { phoneNumberId: status.phoneNumberId, externalMessageId: status.externalMessageId });
      continue;
    }
    const { data: existing, error: messageLookupError } = await database.from("messages").select("id,metadata").eq("owner_id", connection.owner_id).eq("source", "whatsapp").eq("external_message_id", status.externalMessageId).maybeSingle();
    if (messageLookupError) { failedStatuses += 1; continue; }
    if (!existing) continue;
    const metadata = existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata) ? existing.metadata : {};
    const { error: statusError } = await database.from("messages").update({ metadata: { ...metadata, delivery_status: status.status, delivery_status_at: status.timestamp ?? new Date().toISOString(), delivery_errors: status.errors ?? null } }).eq("id", existing.id).eq("owner_id", connection.owner_id);
    if (!statusError) statusUpdates += 1;
    else failedStatuses += 1;
  }

  let imported = 0;
  let failed = 0;
  let unmatchedMessages = 0;
  const analyses: Array<{ ownerId: string; conversationId: string; messageId: string }> = [];

  for (const event of events.messages) {
    try {
      const connection = findWhatsAppWebhookConnection(connections ?? [], event.phoneNumberId);
      if (!connection) {
        unmatchedMessages += 1;
        console.warn("WhatsApp message did not match a connected phone number", {
          phoneNumberId: event.phoneNumberId,
          businessAccountId: event.businessAccountId,
          connectedAccountCount: (connections ?? []).length,
        });
        continue;
      }

      const identityKey = `whatsapp:${event.participantId}`;
      const resolved = await resolveOrCreateChannelPerson({
        database,
        ownerId: connection.owner_id,
        source: "whatsapp",
        externalIdentifier: identityKey,
        displayName: event.participantName,
        username: event.participantId,
        connectionId: connection.id,
        confidence: 0.8,
        contactAt: event.message.sentAt,
        identityMetadata: { phone_number: event.participantId, whatsapp_business_account_id: event.businessAccountId, whatsapp_phone_number_id: event.phoneNumberId },
      });

      const conversationKey = `whatsapp:${connection.id}:${event.participantId}`;
      const { data: existingConversation, error: conversationLookupError } = await database.from("conversations").select("id").eq("owner_id", connection.owner_id).eq("source", "whatsapp").eq("external_conversation_id", conversationKey).maybeSingle();
      if (conversationLookupError) throw conversationLookupError;

      const values = {
        owner_id: connection.owner_id,
        person_id: resolved.personId,
        connection_id: connection.id,
        source: "whatsapp",
        external_conversation_id: conversationKey,
        title: `WhatsApp · ${connection.account_identifier ?? connection.account_name ?? "account"}`,
        conversation_type: "chat",
        last_message_at: event.message.sentAt,
        last_other_message_at: event.message.sentAt,
        updated_at: new Date().toISOString(),
      };
      const conversation = existingConversation?.id
        ? await database.from("conversations").update(values).eq("id", existingConversation.id).eq("owner_id", connection.owner_id).select("id").single()
        : await database.from("conversations").insert(values).select("id").single();
      if (conversation.error || !conversation.data) throw conversation.error ?? new Error("WhatsApp conversation could not be saved.");

      const saved = await database.from("messages").upsert({
        owner_id: connection.owner_id,
        conversation_id: conversation.data.id,
        external_message_id: event.message.externalId,
        direction: "in",
        sender_identity_id: resolved.identityId,
        source: "whatsapp",
        body_text: event.message.body,
        sent_at: event.message.sentAt,
        attachment_count: event.message.attachmentCount,
        metadata: { ...event.message.providerMetadata, connection_id: connection.id },
        processed_at: null,
      }, { onConflict: "owner_id,source,external_message_id", ignoreDuplicates: true }).select("id").maybeSingle();
      if (saved.error) throw saved.error;
      if (saved.data) {
        imported += 1;
        analyses.push({ ownerId: connection.owner_id, conversationId: conversation.data.id, messageId: saved.data.id });
      }
    } catch (error) {
      failed += 1;
      console.error("WhatsApp webhook message ingestion failed", {
        phoneNumberId: event.phoneNumberId,
        code: error && typeof error === "object" && "code" in error ? error.code : "unknown",
      });
    }
  }

  if (analyses.length) after(async () => { await Promise.allSettled(analyses.map(analyzeIncomingWhatsAppMessage)); });
  const retry = failed > 0 || failedStatuses > 0 || unmatchedMessages > 0;
  console.info("WhatsApp webhook processed", { imported, failed, failedStatuses, unmatchedMessages, statusUpdates, unmatchedStatuses });
  return NextResponse.json({
    received: !retry,
    parsedMessages: events.messages.length,
    parsedStatuses: events.statuses.length,
    imported,
    failed,
    unmatchedMessages,
    statusUpdates,
    unmatchedStatuses,
    failedStatuses,
  }, { status: retry ? 503 : 200 });
}
