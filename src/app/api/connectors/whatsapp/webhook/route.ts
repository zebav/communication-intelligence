import { ingestWhatsAppEvents } from "@/lib/connectors/whatsapp-ingestion";
import { NextResponse, type NextRequest } from "next/server";
import { parseWhatsAppWebhook, validWhatsAppWebhookSignature } from "@/lib/connectors/whatsapp-webhook";

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
  return ingestWhatsAppEvents(events);
}
