import { ingestWhatsAppEvents } from "@/lib/connectors/whatsapp-ingestion";
import { NextResponse, type NextRequest } from "next/server";
import { metaDirectWhatsAppProvider } from "@/lib/connectors/whatsapp-webhook";
import { activeWhatsAppProvider, inactiveProviderResponse } from "@/lib/connectors/whatsapp-provider";
import { createAdminClient } from "@/lib/supabase/admin";
import { whatsappConnector } from "@/lib/connectors/whatsapp";
import { findWhatsAppWebhookConnection } from "@/lib/connectors/whatsapp-webhook";

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
  if (!metaDirectWhatsAppProvider.verifyWebhook(rawBody, request.headers.get("x-hub-signature-256"), secret)) {
    console.warn("WhatsApp webhook rejected: invalid signature");
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }
  const activeProvider = activeWhatsAppProvider();
  if (activeProvider !== metaDirectWhatsAppProvider.id) return NextResponse.json(inactiveProviderResponse(metaDirectWhatsAppProvider.id, activeProvider));
  const events = metaDirectWhatsAppProvider.parseWebhook(rawBody, undefined);
  if (events.messages.some((event) => event.message.attachmentCount > 0)) {
    const database = createAdminClient();
    const { data: connections } = await database.from("connections").select("id,owner_id,token_metadata").eq("provider", whatsappConnector.id).eq("status", "connected");
    let raw: { entry?: Array<{ changes?: Array<{ value?: { metadata?: { phone_number_id?: string }; messages?: Array<Record<string, unknown>> } }> }> } = {};
    try { raw = JSON.parse(rawBody) as typeof raw; } catch {}
    for (const entry of raw.entry ?? []) for (const change of entry.changes ?? []) {
      const phoneNumberId = change.value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const connection = findWhatsAppWebhookConnection(connections ?? [], phoneNumberId);
      if (!connection) continue;
      for (const message of change.value?.messages ?? []) {
        const messageId = typeof message.id === "string" ? message.id : "";
        const type = typeof message.type === "string" ? message.type : "";
        const media = ["image","audio","video","document","sticker"].includes(type) && message[type] && typeof message[type] === "object" ? message[type] as Record<string, unknown> : null;
        const mediaId = typeof media?.id === "string" ? media.id : "";
        if (!messageId || !mediaId) continue;
        const { error } = await database.from("vault_media_references").upsert({
          owner_id: connection.owner_id,
          connection_id: connection.id,
          source: "whatsapp",
          provider: "meta-direct",
          provider_message_id: messageId,
          media_type: type,
          media_reference: mediaId,
          mime_type: typeof media?.mime_type === "string" ? media.mime_type : null,
          filename: typeof media?.filename === "string" ? media.filename : null,
        }, { onConflict: "owner_id,source,provider,provider_message_id,media_reference", ignoreDuplicates: true });
        if (error) console.error("WhatsApp media reference save failed", { code: error.code });
      }
    }
  }
  return ingestWhatsAppEvents(events);
}
