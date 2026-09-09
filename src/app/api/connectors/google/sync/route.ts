import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { decryptCredential, encryptCredential } from "@/lib/connectors/credential-crypto";
import { classifyEmail, emailPriority, recommendedEmailAction } from "@/lib/connectors/email-classification";
import { extractGmailBody, gmailAddress, gmailDisplayName, gmailHeader, type GmailPayload } from "@/lib/connectors/gmail-message";
import { googleGmailConnector } from "@/lib/connectors/google-gmail";
import { googleConfig } from "@/lib/connectors/google-oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isAuthorizedCron } from "@/lib/cron-auth";

type StoredCredentials = { accessToken: string; refreshToken?: string; tokenType?: string; scope?: string; expiresAt: string };
type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string; scope?: string };
type GmailMessage = { id?: string; threadId?: string; internalDate?: string; snippet?: string; payload?: GmailPayload; labelIds?: string[] };

function jsonError(message: string, status = 500) { return NextResponse.json({ error: message }, { status }); }

async function accessToken(credentials: StoredCredentials, origin: string) {
  if (new Date(credentials.expiresAt).getTime() > Date.now() + 60_000) return { token: credentials.accessToken, credentials, refreshed: false };
  if (!credentials.refreshToken) throw new Error("reconnect_required");
  const config = googleConfig(origin);
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: credentials.refreshToken }), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("reconnect_required");
  const result = await response.json() as TokenResponse;
  if (!result.access_token || !result.expires_in) throw new Error("reconnect_required");
  const next = { ...credentials, accessToken: result.access_token, refreshToken: result.refresh_token ?? credentials.refreshToken, tokenType: result.token_type ?? credentials.tokenType, scope: result.scope ?? credentials.scope, expiresAt: new Date(Date.now() + result.expires_in * 1000).toISOString() };
  return { token: result.access_token, credentials: next, refreshed: true };
}

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const background = isAuthorizedCron(request.headers.get("authorization"));
  const backgroundOwner = z.string().uuid().safeParse(request.headers.get("x-owner-id"));
  if (background && !backgroundOwner.success) return jsonError("Missing background owner.", 400);
  if (!background && request.headers.get("origin") !== request.nextUrl.origin) return jsonError("Invalid request origin.", 403);
  const supabase = background ? createAdminClient() : await createClient();
  let userId = backgroundOwner.success ? backgroundOwner.data : "";
  if (!background) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError("Your session has expired. Sign in again.", 401);
    const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance?.currentLevel !== "aal2") return jsonError("Two-factor authentication is required.", 403);
    userId = user.id;
  }

  const connectionId = request.nextUrl.searchParams.get("connectionId");
  if (!connectionId) return jsonError("Choose a Gmail account.", 400);
  const { data: connection } = await supabase.from("connections").select("id,account_identifier,encrypted_credentials,token_metadata").eq("id", connectionId).eq("owner_id", userId).eq("provider", googleGmailConnector.id).eq("status", "connected").maybeSingle();
  if (!connection?.encrypted_credentials || !connection.account_identifier) return jsonError("Connect Gmail before importing messages.", 409);
  const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!encryptionKey) return jsonError("The server encryption key is not configured.");

  try {
    const stored = decryptCredential<StoredCredentials>(connection.encrypted_credentials, encryptionKey);
    const authorized = await accessToken(stored, request.nextUrl.origin);
    const metadata = connection.token_metadata && typeof connection.token_metadata === "object" && !Array.isArray(connection.token_metadata) ? connection.token_metadata as Record<string, unknown> : {};
    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("maxResults", "25"); listUrl.searchParams.append("labelIds", "INBOX"); listUrl.searchParams.set("q", "newer_than:30d");
    if (typeof metadata.gmail_page_token === "string") listUrl.searchParams.set("pageToken", metadata.gmail_page_token);
    const listResponse = await fetch(listUrl, { headers: { authorization: `Bearer ${authorized.token}` }, signal: AbortSignal.timeout(15_000) });
    if (listResponse.status === 401) throw new Error("reconnect_required");
    if (!listResponse.ok) throw new Error(`gmail_list_${listResponse.status}`);
    const list = await listResponse.json() as { messages?: Array<{ id?: string }>; nextPageToken?: string };
    let imported = 0; let alreadyStored = 0;
    const profileId = String(metadata.google_profile_id ?? connection.account_identifier);
    const listedIds = (list.messages ?? []).flatMap((item) => item.id ? [item.id] : []);
    const externalIds = listedIds.map((id) => `gmail:${profileId}:${id}`);
    const { data: storedRows } = externalIds.length ? await supabase.from("messages").select("external_message_id").eq("owner_id", userId).eq("source", "email").in("external_message_id", externalIds) : { data: [] };
    const storedIds = new Set((storedRows ?? []).map((row) => row.external_message_id));
    alreadyStored = storedIds.size;
    const newIds = listedIds.filter((id) => !storedIds.has(`gmail:${profileId}:${id}`));
    const messages = await Promise.all(newIds.map(async (id) => {
      const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, { headers: { authorization: `Bearer ${authorized.token}` }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`gmail_message_${response.status}`);
      return response.json() as Promise<GmailMessage>;
    }));

    for (const message of messages) {
      const externalMessageId = `gmail:${profileId}:${message.id}`;
      if (!message.id || !message.threadId) continue;
      const from = gmailHeader(message.payload, "From"); const address = gmailAddress(from);
      if (!address) continue;
      const displayName = gmailDisplayName(from) || address; const subject = gmailHeader(message.payload, "Subject") || "(No subject)";
      const content = extractGmailBody(message.payload, message.snippet); const sentAt = message.internalDate ? new Date(Number(message.internalDate)).toISOString() : new Date().toISOString();
      const { data: identity } = await supabase.from("identities").select("id,person_id").eq("owner_id", userId).eq("source", "email").eq("external_identifier", address).maybeSingle();
      let personId = identity?.person_id; let identityId = identity?.id;
      if (!personId) {
        const { data: person, error: personError } = await supabase.from("people").insert({ owner_id: userId, display_name: displayName, last_contact_at: sentAt }).select("id").single();
        if (personError || !person) throw new Error("person_insert_failed"); personId = person.id;
        const { data: createdIdentity, error: identityError } = await supabase.from("identities").insert({ owner_id: userId, person_id: personId, source: "email", external_identifier: address, metadata: { provider: googleGmailConnector.id }, verified_match: true, confidence: 1 }).select("id").single();
        if (identityError || !createdIdentity) throw new Error("identity_insert_failed"); identityId = createdIdentity.id;
      }
      const classification = classifyEmail({ subject, preview: content, sender: address }); const priority = emailPriority(classification); const externalConversationId = `gmail:${profileId}:${message.threadId}`;
      const { data: existingConversation } = await supabase.from("conversations").select("id").eq("owner_id", userId).eq("source", "email").eq("external_conversation_id", externalConversationId).maybeSingle();
      const conversationValues = { owner_id: userId, person_id: personId, connection_id: connection.id, source: "email", external_conversation_id: externalConversationId, title: subject, conversation_type: "email", priority_score: priority, last_message_at: sentAt, last_other_message_at: sentAt, summary: content.slice(0, 300), recommended_action: { action: recommendedEmailAction(classification), reason: `Initial rule-based classification: ${classification}` }, updated_at: new Date().toISOString() };
      const conversation = existingConversation?.id ? await supabase.from("conversations").update(conversationValues).eq("id", existingConversation.id).select("id").single() : await supabase.from("conversations").insert(conversationValues).select("id").single();
      if (conversation.error || !conversation.data) throw new Error("conversation_save_failed");
      const { error: messageError } = await supabase.from("messages").insert({ owner_id: userId, conversation_id: conversation.data.id, external_message_id: externalMessageId, direction: "in", sender_identity_id: identityId, source: "email", body_text: content, sent_at: sentAt, classification, importance_score: priority, metadata: { provider: googleGmailConnector.id, account: connection.account_identifier, gmail_labels: message.labelIds ?? [] }, processed_at: new Date().toISOString() });
      if (messageError) throw new Error("message_save_failed"); imported += 1;
    }

    const syncedAt = new Date().toISOString();
    const nextMetadata = { ...metadata, expires_at: authorized.credentials.expiresAt, gmail_page_token: list.nextPageToken ?? null, gmail_initial_import_complete: !list.nextPageToken };
    const update: Record<string, unknown> = { last_sync_at: syncedAt, health_status: "healthy", token_metadata: nextMetadata, updated_at: syncedAt };
    if (authorized.refreshed) update.encrypted_credentials = encryptCredential(authorized.credentials, encryptionKey);
    await supabase.from("connections").update(update).eq("id", connection.id).eq("owner_id", userId);
    return NextResponse.json({ imported, alreadyStored, syncedAt, moreAvailable: Boolean(list.nextPageToken), initialImportComplete: !list.nextPageToken });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown"; console.error("Gmail sync failed", { reason });
    if (reason === "reconnect_required") return jsonError("Gmail needs to be connected again.", 409);
    return jsonError("The Gmail messages could not be imported. Try again.");
  }
}
