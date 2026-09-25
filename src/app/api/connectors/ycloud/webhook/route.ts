import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ingestWhatsAppEvents } from "@/lib/connectors/whatsapp-ingestion";
import { parseYCloudEvent, ycloudWhatsAppProvider } from "@/lib/connectors/ycloud-webhook";
import { activeWhatsAppProvider, inactiveProviderResponse } from "@/lib/connectors/whatsapp-provider";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  const secret = process.env.YCLOUD_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "YCloud webhook is not configured." }, { status: 503 });
  const raw = await request.text();
  if (!ycloudWhatsAppProvider.verifyWebhook(raw, request.headers.get("ycloud-signature"), secret)) return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  const activeProvider = activeWhatsAppProvider();
  if (activeProvider !== ycloudWhatsAppProvider.id) return NextResponse.json(inactiveProviderResponse(ycloudWhatsAppProvider.id, activeProvider));
  let event;
  try { event = parseYCloudEvent(raw); } catch { return NextResponse.json({ error: "Invalid event." }, { status: 400 }); }
  if (!event) return NextResponse.json({ received: true, ignored: true });
  const database = createAdminClient();
  const { data, error } = await database.from("connections").select("id,owner_id,account_identifier,token_metadata").eq("provider", "whatsapp-business").eq("status", "connected");
  if (error) return NextResponse.json({ error: "Connection lookup failed." }, { status: 503 });
  const matches = (data ?? []).filter((connection) => {
    const metadata = connection.token_metadata as Record<string, unknown> | null;
    return metadata?.business_account_id === event.value.wabaId && String(connection.account_identifier ?? "").replace(/[\s()+-]/g, "") === event.businessPhone && /^\d+$/.test(String(metadata?.phone_number_id ?? ""));
  });
  if (matches.length !== 1) return NextResponse.json({ error: "No unique connection for this WABA and number." }, { status: 503 });
  const metadata = matches[0].token_metadata as Record<string, unknown>;
  let normalized;
  try { normalized = ycloudWhatsAppProvider.parseWebhook(raw, { phoneNumberId: String(metadata.phone_number_id) }); } catch { return NextResponse.json({ error: "Invalid message." }, { status: 400 }); }
  const providerMessage = normalized.messages[0];
  let rawMedia: Record<string, unknown> | null = null;
  try {
    const parsedRaw = JSON.parse(raw) as { whatsappInboundMessage?: Record<string, unknown>; whatsappMessage?: Record<string, unknown> };
    const rawMessage = event.direction === "in" ? parsedRaw.whatsappInboundMessage : parsedRaw.whatsappMessage;
    const type = typeof rawMessage?.type === "string" ? rawMessage.type : "";
    rawMedia = type && rawMessage?.[type] && typeof rawMessage[type] === "object" ? rawMessage[type] as Record<string, unknown> : null;
  } catch {}
  const mediaUrl = typeof rawMedia?.link === "string" ? rawMedia.link : "";
  const mediaId = typeof rawMedia?.id === "string" ? rawMedia.id : "";
  const mediaReference = mediaUrl.startsWith("https://") ? mediaUrl : mediaId;
  if (providerMessage?.message.attachmentCount && mediaReference) {
    const { error: mediaRefError } = await database.from("vault_media_references").upsert({
      owner_id: (matches[0] as { owner_id?: string }).owner_id,
      connection_id: (matches[0] as { id?: string }).id,
      source: "whatsapp",
      provider: "ycloud",
      provider_message_id: providerMessage.message.externalId,
      media_type: providerMessage.message.providerMetadata?.whatsapp_message_type ?? null,
      media_reference: mediaReference,
      mime_type: typeof rawMedia?.mimeType === "string" ? rawMedia.mimeType : null,
      filename: typeof rawMedia?.filename === "string" ? rawMedia.filename : null,
    }, { onConflict: "owner_id,source,provider,provider_message_id,media_reference", ignoreDuplicates: true });
    if (mediaRefError) return NextResponse.json({ error: "Media reference could not be stored." }, { status: 503 });
  }
  return ingestWhatsAppEvents(normalized);
}
