import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { decryptCredential } from "@/lib/connectors/credential-crypto";
import { whatsappConnector } from "@/lib/connectors/whatsapp";
import { whatsappMessagesUrl, whatsappSendBody } from "@/lib/connectors/whatsapp-api";

const schema = z.object({ conversationId: z.string().uuid(), body: z.string().trim().min(1).max(4096) });
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
  const { data: connection } = await database.from("connections").select("id,encrypted_credentials,token_metadata").eq("id", conversation.connection_id).eq("owner_id", user.id).eq("provider", whatsappConnector.id).eq("status", "connected").maybeSingle();
  if (!connection?.encrypted_credentials) return jsonError("Connect WhatsApp before sending.", 409);
  const metadata = connection.token_metadata && typeof connection.token_metadata === "object" && !Array.isArray(connection.token_metadata) ? connection.token_metadata as Record<string, unknown> : {};
  const phoneNumberId = String(metadata.phone_number_id ?? "");
  const recipient = conversation.external_conversation_id?.split(":").at(-1) ?? "";
  const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!encryptionKey) return jsonError("The server encryption key is not configured.");
  try {
    const credentials = decryptCredential<{ accessToken?: string }>(connection.encrypted_credentials, encryptionKey);
    if (!credentials.accessToken) return jsonError("WhatsApp needs to be connected again.", 409);
    const response = await fetch(whatsappMessagesUrl(phoneNumberId), { method: "POST", headers: { authorization: `Bearer ${credentials.accessToken}`, "content-type": "application/json" }, body: JSON.stringify(whatsappSendBody(recipient, parsed.data.body)), signal: AbortSignal.timeout(20_000) });
    if (response.status === 401 || response.status === 403) return jsonError("WhatsApp permission is missing. Connect WhatsApp again.", 409);
    if (!response.ok) throw new Error(`whatsapp_${response.status}`);
    const result = await response.json() as { messages?: Array<{ id?: string }> };
    const sentAt = new Date().toISOString();
    const externalId = result.messages?.[0]?.id ?? `local-whatsapp-${crypto.randomUUID()}`;
    await database.from("messages").upsert({ owner_id: user.id, conversation_id: conversation.id, external_message_id: externalId, direction: "out", source: "whatsapp", body_text: parsed.data.body, sent_at: sentAt, processed_at: sentAt, metadata: { provider: whatsappConnector.id, connection_id: connection.id, sent_with_owner_approval: true, delivery_status: "accepted" } }, { onConflict: "owner_id,source,external_message_id", ignoreDuplicates: true });
    await database.from("conversations").update({ last_message_at: sentAt, last_user_message_at: sentAt, updated_at: sentAt }).eq("id", conversation.id).eq("owner_id", user.id);
    await database.from("audit_logs").insert({ owner_id: user.id, actor_id: user.id, action: "message.sent", object_type: "conversation", object_id: conversation.id, source: "whatsapp", actor_type: "user", new_value: { provider: whatsappConnector.id, external_message_id: externalId, sent_at: sentAt } });
    return NextResponse.json({ success: true, sentAt });
  } catch (error) {
    console.error("WhatsApp reply failed", error instanceof Error ? error.message : "unknown");
    return jsonError("The WhatsApp reply could not be sent. Try again.");
  }
}
