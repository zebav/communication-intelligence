import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { decryptCredential } from "@/lib/connectors/credential-crypto";
import { whatsappConnector } from "@/lib/connectors/whatsapp";
import { activeWhatsAppProvider } from "@/lib/connectors/whatsapp-provider";
import { assertWhatsAppReplyWindow, sendWhatsAppText } from "@/lib/connectors/whatsapp-send";

const schema = z.object({ conversationId: z.string().uuid(), body: z.string().trim().min(1).max(4096), expectedRecipient: z.string().optional(), expectedConnectionId: z.string().uuid().optional() });
const jsonError = (error: string, status = 500) => NextResponse.json({ error }, { status });

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return jsonError("Invalid request origin.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Check the WhatsApp reply and try again.", 400);
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) return jsonError("Your session has expired. Sign in again.", 401);
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return jsonError("Two-factor authentication is required.", 403);
  const { data: conversation } = await database.from("conversations").select("id,connection_id,external_conversation_id").eq("id", parsed.data.conversationId).eq("owner_id", user.id).eq("source", "whatsapp").maybeSingle();
  if (!conversation?.connection_id) return jsonError("The WhatsApp conversation could not be found.", 404);
  if (parsed.data.expectedConnectionId && parsed.data.expectedConnectionId !== conversation.connection_id) return jsonError("Kontot har ändrats. Granska på nytt.", 409);
  const { data: connection } = await database.from("connections").select("id,account_identifier,encrypted_credentials,token_metadata").eq("id", conversation.connection_id).eq("owner_id", user.id).eq("provider", whatsappConnector.id).eq("status", "connected").maybeSingle();
  if (!connection) return jsonError("Connect WhatsApp before sending.", 409);
  const metadata = connection.token_metadata && typeof connection.token_metadata === "object" && !Array.isArray(connection.token_metadata) ? connection.token_metadata as Record<string, unknown> : {};
  const phoneNumberId = String(metadata.phone_number_id ?? "");
  const recipient = conversation.external_conversation_id?.split(":").at(-1) ?? "";
  if (parsed.data.expectedRecipient && parsed.data.expectedRecipient !== recipient) return jsonError("Mottagaren har ändrats. Granska på nytt.", 409);
  const provider = activeWhatsAppProvider();
  const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  try {
    const { data: inbound, error: inboundError } = await database.from("messages").select("sent_at").eq("owner_id", user.id).eq("conversation_id", conversation.id).eq("direction", "in").order("sent_at", { ascending: false }).limit(1).maybeSingle();
    if (inboundError) return jsonError("Svarsfönstret kunde inte verifieras.", 409);
    assertWhatsAppReplyWindow(inbound?.sent_at ?? null);
    let credential = "";
    if (provider === "ycloud") credential = process.env.YCLOUD_API_KEY?.trim() ?? "";
    else if (encryptionKey && connection.encrypted_credentials) credential = decryptCredential<{ accessToken?: string }>(connection.encrypted_credentials, encryptionKey).accessToken ?? "";
    if (!credential) return jsonError("Sändningsnyckel saknas för vald WhatsApp-leverantör.", 409);
    const result = await sendWhatsAppText({ provider, from: connection.account_identifier ?? "", to: recipient, phoneNumberId, body: parsed.data.body, credential });
    const sentAt = new Date().toISOString();
    const externalId = result.externalId;
    const { error: messageError } = await database.from("messages").upsert({ owner_id: user.id, conversation_id: conversation.id, external_message_id: externalId, direction: "out", source: "whatsapp", body_text: parsed.data.body, sent_at: sentAt, processed_at: sentAt, metadata: { provider, connection_id: connection.id, sent_with_owner_approval: true, delivery_status: "accepted" } }, { onConflict: "owner_id,source,external_message_id", ignoreDuplicates: true });
    const { error: conversationError } = await database.from("conversations").update({ last_message_at: sentAt, last_user_message_at: sentAt, updated_at: sentAt }).eq("id", conversation.id).eq("owner_id", user.id);
    const { error: auditError } = await database.from("audit_logs").insert({ owner_id: user.id, actor_id: user.id, action: "message.sent", object_type: "conversation", object_id: conversation.id, source: "whatsapp", actor_type: "user", new_value: { provider, external_message_id: externalId, sent_at: sentAt } });
    return NextResponse.json({ success: true, sentAt, externalId, warning: messageError || conversationError || auditError ? "Leverantören har accepterat meddelandet men lokal historik kunde inte uppdateras helt. Skicka inte igen." : undefined });
  } catch (error) {
    console.error("WhatsApp reply failed", error instanceof Error ? error.message : "unknown");
    return jsonError("Utskickets resultat kunde inte bekräftas. Kontrollera WhatsApp innan du försöker igen.");
  }
}
