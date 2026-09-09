import { NextResponse, type NextRequest } from "next/server";
import { decryptCredential, encryptCredential } from "@/lib/connectors/credential-crypto";
import { classifyEmail, emailPriority, recommendedEmailAction } from "@/lib/connectors/email-classification";
import { microsoftGraphConnector } from "@/lib/connectors/microsoft-graph";
import { initialInboxDeltaUrl, validatedInboxDeltaUrl } from "@/lib/connectors/microsoft-delta";
import { extractMicrosoftMessageText, type MicrosoftItemBody } from "@/lib/connectors/microsoft-message";
import { microsoftConfig } from "@/lib/connectors/microsoft-oauth";
import { normalizeCommunicationMessage } from "@/lib/connectors/normalization";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { senderRelevance } from "@/lib/sender-intelligence";
import { responseTimeMinutes } from "@/lib/outcomes";
import { z } from "zod";

type StoredCredentials = { accessToken: string; refreshToken?: string; tokenType?: string; scope?: string; expiresAt: string };
type GraphAddress = { emailAddress?: { name?: string; address?: string } };
type GraphMessage = {
  id: string;
  "@removed"?: { reason?: string };
  conversationId?: string;
  internetMessageId?: string;
  subject?: string;
  body?: MicrosoftItemBody;
  uniqueBody?: MicrosoftItemBody;
  bodyPreview?: string;
  from?: GraphAddress;
  receivedDateTime?: string;
  sentDateTime?: string;
  importance?: string;
  inferenceClassification?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
};
type GraphMessagesResponse = { value?: GraphMessage[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string; scope?: string };

function jsonError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

async function getAccessToken(credentials: StoredCredentials, origin: string) {
  if (new Date(credentials.expiresAt).getTime() > Date.now() + 60_000) return { accessToken: credentials.accessToken, credentials, refreshed: false };
  if (!credentials.refreshToken) throw new Error("reconnect_required");
  const config = microsoftConfig(origin);
  const response = await fetch(`https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
      scope: microsoftGraphConnector.scopes.join(" "),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("reconnect_required");
  const tokens = await response.json() as TokenResponse;
  if (!tokens.access_token || !tokens.expires_in) throw new Error("reconnect_required");
  const next = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? credentials.refreshToken,
    tokenType: tokens.token_type ?? credentials.tokenType,
    scope: tokens.scope ?? credentials.scope,
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  };
  return { accessToken: tokens.access_token, credentials: next, refreshed: true };
}

export async function POST(request: NextRequest) {
  const background = isAuthorizedCron(request.headers.get("authorization"));
  const backgroundOwner = z.string().uuid().safeParse(request.headers.get("x-owner-id"));
  if (background && !backgroundOwner.success) return jsonError("Missing background owner.", 400);
  if (!background && request.headers.get("origin") !== request.nextUrl.origin) return jsonError("Invalid request origin.", 403);
  const supabase = background ? createAdminClient() : await createClient();
  let userId: string;
  if (background) {
    userId = backgroundOwner.data!;
  } else {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError("Your session has expired. Sign in again.", 401);
    const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance?.currentLevel !== "aal2") return jsonError("Two-factor authentication is required.", 403);
    userId = user.id;
  }

  const requestedConnectionId = request.nextUrl.searchParams.get("connectionId");
  let connectionQuery = supabase.from("connections")
    .select("id,encrypted_credentials,token_metadata,last_sync_at")
    .eq("owner_id", userId).eq("provider", microsoftGraphConnector.id).eq("status", "connected");
  if (requestedConnectionId) connectionQuery = connectionQuery.eq("id", requestedConnectionId);
  const { data: connection, error: connectionError } = await connectionQuery.order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (connectionError || !connection?.encrypted_credentials) return jsonError("Connect Outlook before importing messages.", 409);
  if (request.headers.get("x-sync-trigger") === "automatic" && connection.last_sync_at && Date.now() - new Date(connection.last_sync_at).getTime() < 5 * 60 * 1000) {
    return NextResponse.json({ imported: 0, skipped: true, syncedAt: connection.last_sync_at });
  }
  const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!encryptionKey) return jsonError("The server encryption key is not configured.");

  try {
    const stored = decryptCredential<StoredCredentials>(connection.encrypted_credentials, encryptionKey);
    const token = await getAccessToken(stored, request.nextUrl.origin);
    if (token.refreshed) {
      const { error } = await supabase.from("connections").update({
        encrypted_credentials: encryptCredential(token.credentials, encryptionKey),
        token_metadata: { ...(connection.token_metadata as object ?? {}), expires_at: token.credentials.expiresAt },
        updated_at: new Date().toISOString(),
      }).eq("id", connection.id);
      if (error) throw new Error("credential_update_failed");
    }

    const metadata = connection.token_metadata && typeof connection.token_metadata === "object" && !Array.isArray(connection.token_metadata)
      ? connection.token_metadata as Record<string, unknown>
      : {};
    // Existing cursors were created before full bodies were selected. Restart
    // once from the bounded 30-day window so existing previews are upgraded.
    const needsFullBodyUpgrade = metadata.full_body_sync_v1 !== true;
    let pageUrl = needsFullBodyUpgrade ? initialInboxDeltaUrl() : validatedInboxDeltaUrl(metadata.inbox_sync_url);
    let nextSyncUrl: string | undefined;
    let deltaReady = false;
    let pagesProcessed = 0;
    let imported = 0;

    // Process several pages per request, while retaining Graph's opaque cursor if
    // more pages remain. This keeps server execution bounded and makes each click
    // progress toward a complete mailbox snapshot.
    while (pagesProcessed < 4) {
      const graphResponse = await fetch(pageUrl, {
        headers: { authorization: `Bearer ${token.accessToken}`, prefer: 'outlook.body-content-type="text"' },
        signal: AbortSignal.timeout(20_000),
      });
      if (graphResponse.status === 401) return jsonError("Outlook needs to be connected again.", 409);
      if (!graphResponse.ok) throw new Error(`graph_${graphResponse.status}`);
      const graph = await graphResponse.json() as GraphMessagesResponse;
      pagesProcessed += 1;

      for (const message of graph.value ?? []) {
      if (message["@removed"]) continue;
      const address = message.from?.emailAddress?.address?.trim().toLowerCase();
      if (!message.id || !address) continue;
      const displayName = message.from?.emailAddress?.name?.trim() || address;
      const { data: identity, error: identityLookupError } = await supabase.from("identities").select("id,person_id")
        .eq("owner_id", userId).eq("source", "email").eq("external_identifier", address).maybeSingle();
      if (identityLookupError) throw new Error(`identity_lookup_failed_${identityLookupError.code}`);
      let personId = identity?.person_id;
      let identityId = identity?.id;
      if (!personId) {
        const { data: person, error: personError } = await supabase.from("people").insert({
          owner_id: userId, display_name: displayName, last_contact_at: message.receivedDateTime ?? new Date().toISOString(),
        }).select("id").single();
        if (personError || !person) throw new Error("person_insert_failed");
        personId = person.id;
        const { data: newIdentity, error: identityError } = await supabase.from("identities").insert({
          owner_id: userId, person_id: personId, source: "email", external_identifier: address,
          metadata: { provider: microsoftGraphConnector.id }, verified_match: true, confidence: 1,
        }).select("id").single();
        if (identityError || !newIdentity) throw new Error(`identity_insert_failed_${identityError?.code ?? "unknown"}`);
        identityId = newIdentity.id;
      }

      const content = extractMicrosoftMessageText(message);
      const normalized = normalizeCommunicationMessage(microsoftGraphConnector, { externalId: message.id, externalConversationId: message.conversationId, direction: "in", senderIdentifier: address, senderName: displayName, subject: message.subject, body: content.text, sentAt: message.receivedDateTime ?? message.sentDateTime ?? new Date().toISOString(), attachmentCount: message.hasAttachments ? 1 : 0, metadata: { internet_message_id: message.internetMessageId, is_read: message.isRead ?? false, content_source: content.source, full_content: content.fullContent, body_truncated: content.truncated } });
      const classification = classifyEmail({ subject: message.subject, preview: content.text, sender: address, importance: message.importance, inferenceClassification: message.inferenceClassification });
      const basePriority = emailPriority(classification, message.importance);
      const { data: senderPreferences } = await supabase.from("people").select("relationship_type,manual_priority,email_handling_rule,sender_preferences_verified").eq("id", personId).eq("owner_id", userId).maybeSingle();
      const relevance = senderRelevance({
        basePriority,
        relationshipType: senderPreferences?.sender_preferences_verified ? senderPreferences.relationship_type : null,
        manualPriority: senderPreferences?.sender_preferences_verified && senderPreferences.manual_priority != null ? Number(senderPreferences.manual_priority) : null,
        handlingRule: senderPreferences?.sender_preferences_verified ? senderPreferences.email_handling_rule : "normal",
      });
      const priority = relevance.score;
      const action = recommendedEmailAction(classification);
      const sentAt = normalized.sentAt;
      const { data: existingConversation } = await supabase.from("conversations").select("id")
        .eq("owner_id", userId).eq("source", normalized.source).eq("external_conversation_id", normalized.externalConversationId).maybeSingle();
      const conversationValues = {
        owner_id: userId, person_id: personId, connection_id: connection.id, source: normalized.source, external_conversation_id: normalized.externalConversationId,
        title: normalized.subject || "(No subject)", conversation_type: normalized.channelKind, priority_score: priority,
        last_message_at: sentAt, last_other_message_at: sentAt, summary: content.text.slice(0, 300),
        recommended_action: { action, reason: `Initial rule-based classification: ${classification}`, relevance_reasons: relevance.reasons }, updated_at: new Date().toISOString(),
      };
      const conversationResult = existingConversation?.id
        ? await supabase.from("conversations").update(conversationValues).eq("id", existingConversation.id).select("id").single()
        : await supabase.from("conversations").insert(conversationValues).select("id").single();
      if (conversationResult.error || !conversationResult.data) throw new Error("conversation_save_failed");
      const { data: savedIncoming, error: messageError } = await supabase.from("messages").upsert({
        owner_id: userId, conversation_id: conversationResult.data.id, external_message_id: normalized.externalId,
        direction: normalized.direction, sender_identity_id: identityId, source: normalized.source, body_text: normalized.body,
        sent_at: sentAt, classification, importance_score: priority,
        attachment_count: normalized.attachmentCount,
        metadata: normalized.providerMetadata,
        processed_at: new Date().toISOString(),
      }, { onConflict: "owner_id,source,external_message_id" }).select("id").single();
      if (messageError) throw new Error("message_save_failed");
      const { data: waitingOutcome } = await supabase.from("communication_outcomes").select("id,trigger_message_id").eq("owner_id", userId).eq("conversation_id", conversationResult.data.id).eq("status", "waiting").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (waitingOutcome && savedIncoming?.id) {
        const { data: trigger } = await supabase.from("messages").select("sent_at").eq("id", waitingOutcome.trigger_message_id).eq("owner_id", userId).maybeSingle();
        const responseMinutes = trigger?.sent_at ? responseTimeMinutes(trigger.sent_at, sentAt) : null;
        if (responseMinutes != null) await supabase.from("communication_outcomes").update({ response_message_id: savedIncoming.id, status: "reply_received", response_time_minutes: responseMinutes, evidence: { provider: microsoftGraphConnector.id, detection: "later_incoming_message" }, updated_at: new Date().toISOString() }).eq("id", waitingOutcome.id).eq("owner_id", userId);
      }
      imported += 1;
      }

      nextSyncUrl = graph["@odata.nextLink"] ?? graph["@odata.deltaLink"];
      deltaReady = Boolean(graph["@odata.deltaLink"]);
      if (!graph["@odata.nextLink"]) break;
      pageUrl = validatedInboxDeltaUrl(graph["@odata.nextLink"]);
    }

    // Learn the owner's writing style only from recent sent messages that belong
    // to an already imported conversation. They are never analyzed on their own.
    const sentUrl = new URL("https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages");
    sentUrl.searchParams.set("$top", "100");
    sentUrl.searchParams.set("$orderby", "sentDateTime desc");
    sentUrl.searchParams.set("$select", "id,conversationId,internetMessageId,subject,body,uniqueBody,bodyPreview,sentDateTime,hasAttachments");
    const sentResponse = await fetch(sentUrl, { headers: { authorization: `Bearer ${token.accessToken}`, prefer: 'outlook.body-content-type="text"' }, signal: AbortSignal.timeout(20_000) });
    let styleSamples = 0;
    if (sentResponse.ok) {
      const sent = await sentResponse.json() as GraphMessagesResponse;
      for (const message of sent.value ?? []) {
        if (!message.id || !message.conversationId) continue;
        const content = extractMicrosoftMessageText(message);
        if (!content.text) continue;
        const normalized = normalizeCommunicationMessage(microsoftGraphConnector, { externalId: message.id, externalConversationId: message.conversationId, direction: "out", subject: message.subject, body: content.text, sentAt: message.sentDateTime ?? new Date().toISOString(), attachmentCount: message.hasAttachments ? 1 : 0, metadata: { internet_message_id: message.internetMessageId, style_reference: true, content_source: content.source, full_content: content.fullContent, body_truncated: content.truncated } });
        const { data: matchingConversation } = await supabase.from("conversations").select("id")
          .eq("owner_id", userId).eq("source", normalized.source).eq("external_conversation_id", normalized.externalConversationId).maybeSingle();
        if (!matchingConversation) continue;
        const sentAt = normalized.sentAt;
        const { error: sentMessageError } = await supabase.from("messages").upsert({
          owner_id: userId, conversation_id: matchingConversation.id, external_message_id: normalized.externalId,
          direction: normalized.direction, source: normalized.source, body_text: normalized.body, sent_at: sentAt,
          attachment_count: normalized.attachmentCount,
          metadata: normalized.providerMetadata,
        }, { onConflict: "owner_id,source,external_message_id" });
        if (!sentMessageError) {
          styleSamples += 1;
          await supabase.from("conversations").update({ last_user_message_at: sentAt }).eq("id", matchingConversation.id).eq("owner_id", userId);
        }
      }
    }

    const syncedAt = new Date().toISOString();
    const { error: connectionUpdateError } = await supabase.from("connections").update({
      last_sync_at: syncedAt,
      health_status: "healthy",
      token_metadata: {
        ...metadata,
        expires_at: token.credentials.expiresAt,
        inbox_sync_url: nextSyncUrl,
        inbox_delta_ready: deltaReady,
        full_body_sync_v1: true,
      },
      updated_at: syncedAt,
    }).eq("id", connection.id);
    if (connectionUpdateError) throw new Error("sync_cursor_save_failed");
    return NextResponse.json({ imported, styleSamples, syncedAt, incremental: !needsFullBodyUpgrade && Boolean(metadata.inbox_sync_url), fullBodyUpgrade: needsFullBodyUpgrade, pagesProcessed, moreAvailable: Boolean(nextSyncUrl?.includes("$skiptoken") || nextSyncUrl?.includes("%24skiptoken")) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("Microsoft mailbox sync failed", { reason });
    if (reason === "reconnect_required") return jsonError("Outlook needs to be connected again.", 409);
    return jsonError("The Outlook messages could not be imported. Try again.");
  }
}
