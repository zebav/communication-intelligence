import { NextResponse, type NextRequest } from "next/server";
import { decryptCredential, encryptCredential } from "@/lib/connectors/credential-crypto";
import { classifyEmail, emailPriority, recommendedEmailAction } from "@/lib/connectors/email-classification";
import { microsoftGraphConnector } from "@/lib/connectors/microsoft-graph";
import { microsoftConfig } from "@/lib/connectors/microsoft-oauth";
import { createClient } from "@/lib/supabase/server";

type StoredCredentials = { accessToken: string; refreshToken?: string; tokenType?: string; scope?: string; expiresAt: string };
type GraphAddress = { emailAddress?: { name?: string; address?: string } };
type GraphMessage = {
  id: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string;
  bodyPreview?: string;
  from?: GraphAddress;
  receivedDateTime?: string;
  sentDateTime?: string;
  importance?: string;
  inferenceClassification?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
};
type GraphMessagesResponse = { value?: GraphMessage[] };
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
  if (request.headers.get("origin") !== request.nextUrl.origin) return jsonError("Invalid request origin.", 403);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Your session has expired. Sign in again.", 401);
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return jsonError("Two-factor authentication is required.", 403);

  const { data: connection, error: connectionError } = await supabase.from("connections")
    .select("id,encrypted_credentials,token_metadata")
    .eq("owner_id", user.id).eq("provider", microsoftGraphConnector.id).eq("status", "connected")
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (connectionError || !connection?.encrypted_credentials) return jsonError("Connect Outlook before importing messages.", 409);
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

    const url = new URL("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages");
    url.searchParams.set("$top", "25");
    url.searchParams.set("$orderby", "receivedDateTime desc");
    url.searchParams.set("$select", "id,conversationId,internetMessageId,subject,bodyPreview,from,receivedDateTime,sentDateTime,importance,inferenceClassification,isRead,hasAttachments");
    const graphResponse = await fetch(url, {
      headers: { authorization: `Bearer ${token.accessToken}`, prefer: 'outlook.body-content-type="text"' },
      signal: AbortSignal.timeout(20_000),
    });
    if (graphResponse.status === 401) return jsonError("Outlook needs to be connected again.", 409);
    if (!graphResponse.ok) throw new Error(`graph_${graphResponse.status}`);
    const graph = await graphResponse.json() as GraphMessagesResponse;
    let imported = 0;

    for (const message of graph.value ?? []) {
      const address = message.from?.emailAddress?.address?.trim().toLowerCase();
      if (!message.id || !address) continue;
      const displayName = message.from?.emailAddress?.name?.trim() || address;
      const { data: identity, error: identityLookupError } = await supabase.from("identities").select("id,person_id")
        .eq("owner_id", user.id).eq("source", "email").eq("external_identifier", address).maybeSingle();
      if (identityLookupError) throw new Error(`identity_lookup_failed_${identityLookupError.code}`);
      let personId = identity?.person_id;
      let identityId = identity?.id;
      if (!personId) {
        const { data: person, error: personError } = await supabase.from("people").insert({
          owner_id: user.id, display_name: displayName, last_contact_at: message.receivedDateTime ?? new Date().toISOString(),
        }).select("id").single();
        if (personError || !person) throw new Error("person_insert_failed");
        personId = person.id;
        const { data: newIdentity, error: identityError } = await supabase.from("identities").insert({
          owner_id: user.id, person_id: personId, source: "email", external_identifier: address,
          metadata: { provider: microsoftGraphConnector.id }, verified_match: true, confidence: 1,
        }).select("id").single();
        if (identityError || !newIdentity) throw new Error(`identity_insert_failed_${identityError?.code ?? "unknown"}`);
        identityId = newIdentity.id;
      }

      const externalConversationId = message.conversationId ?? message.id;
      const classification = classifyEmail({ subject: message.subject, preview: message.bodyPreview, sender: address, importance: message.importance, inferenceClassification: message.inferenceClassification });
      const priority = emailPriority(classification, message.importance);
      const action = recommendedEmailAction(classification);
      const sentAt = message.receivedDateTime ?? message.sentDateTime ?? new Date().toISOString();
      const { data: existingConversation } = await supabase.from("conversations").select("id")
        .eq("owner_id", user.id).eq("source", "email").eq("external_conversation_id", externalConversationId).maybeSingle();
      const conversationValues = {
        owner_id: user.id, person_id: personId, source: "email", external_conversation_id: externalConversationId,
        title: message.subject || "(No subject)", conversation_type: "email", priority_score: priority,
        last_message_at: sentAt, last_other_message_at: sentAt, summary: (message.bodyPreview ?? "").slice(0, 300),
        recommended_action: { action, reason: `Initial rule-based classification: ${classification}` }, updated_at: new Date().toISOString(),
      };
      const conversationResult = existingConversation?.id
        ? await supabase.from("conversations").update(conversationValues).eq("id", existingConversation.id).select("id").single()
        : await supabase.from("conversations").insert(conversationValues).select("id").single();
      if (conversationResult.error || !conversationResult.data) throw new Error("conversation_save_failed");
      const { error: messageError } = await supabase.from("messages").upsert({
        owner_id: user.id, conversation_id: conversationResult.data.id, external_message_id: message.id,
        direction: "in", sender_identity_id: identityId, source: "email", body_text: message.bodyPreview ?? "",
        sent_at: sentAt, classification, importance_score: priority,
        attachment_count: message.hasAttachments ? 1 : 0,
        metadata: { provider: microsoftGraphConnector.id, internet_message_id: message.internetMessageId, is_read: message.isRead ?? false },
        processed_at: new Date().toISOString(),
      }, { onConflict: "owner_id,source,external_message_id" });
      if (messageError) throw new Error("message_save_failed");
      imported += 1;
    }

    const syncedAt = new Date().toISOString();
    await supabase.from("connections").update({ last_sync_at: syncedAt, health_status: "healthy", updated_at: syncedAt }).eq("id", connection.id);
    return NextResponse.json({ imported, syncedAt });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("Microsoft mailbox sync failed", { reason });
    if (reason === "reconnect_required") return jsonError("Outlook needs to be connected again.", 409);
    return jsonError("The Outlook messages could not be imported. Try again.");
  }
}
