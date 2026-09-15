import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ingestWhatsAppEvents } from "@/lib/connectors/whatsapp-ingestion";
import { parseYCloudEvent, validYCloudSignature, ycloudMessage } from "@/lib/connectors/ycloud-webhook";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  const secret = process.env.YCLOUD_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "YCloud webhook is not configured." }, { status: 503 });
  const raw = await request.text();
  if (!validYCloudSignature(raw, request.headers.get("ycloud-signature"), secret)) return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  let event;
  try { event = parseYCloudEvent(raw); } catch { return NextResponse.json({ error: "Invalid event." }, { status: 400 }); }
  if (!event) return NextResponse.json({ received: true, ignored: true });
  const database = createAdminClient();
  const { data, error } = await database.from("connections").select("account_identifier,token_metadata").eq("provider", "whatsapp-business").eq("status", "connected");
  if (error) return NextResponse.json({ error: "Connection lookup failed." }, { status: 503 });
  const matches = (data ?? []).filter((connection) => {
    const metadata = connection.token_metadata as Record<string, unknown> | null;
    return metadata?.business_account_id === event.value.wabaId && String(connection.account_identifier ?? "").replace(/[\s()+-]/g, "") === event.businessPhone && /^\d+$/.test(String(metadata?.phone_number_id ?? ""));
  });
  if (matches.length !== 1) return NextResponse.json({ error: "No unique connection for this WABA and number." }, { status: 503 });
  const metadata = matches[0].token_metadata as Record<string, unknown>;
  let normalized;
  try { normalized = ycloudMessage(event, String(metadata.phone_number_id)); } catch { return NextResponse.json({ error: "Invalid message." }, { status: 400 }); }
  return ingestWhatsAppEvents({ messages: [normalized], statuses: [] });
}
