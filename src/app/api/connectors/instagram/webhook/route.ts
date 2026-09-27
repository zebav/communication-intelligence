import { after, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { instagramConnector } from "@/lib/connectors/instagram";
import { findInstagramWebhookConnection, parseInstagramWebhook, validInstagramWebhookSignature } from "@/lib/connectors/instagram-webhook";
import { analyzeIncomingInstagramMessage } from "@/lib/connectors/instagram-intelligence";
import { decryptCredential } from "@/lib/connectors/credential-crypto";
import { instagramUserProfileUrl } from "@/lib/connectors/instagram-api";
import { resolveOrCreateChannelPerson } from "@/lib/connectors/person-resolution";
import { enqueueMediaAnalysis } from "@/lib/media/vault-queue";
import { downloadEphemeralInstagramMedia, ephemeralInstagramMediaUrls } from "@/lib/connectors/instagram-media";
import { ingestTrustedMediaAttachments, type MediaJob } from "@/lib/media/email-worker";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  if (mode === "subscribe" && challenge && token && token === process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  return new NextResponse("Webhook verification failed.", { status: 403 });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const secret = process.env.INSTAGRAM_APP_SECRET ?? "";
  if (!validInstagramWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"), secret)) {
    console.warn("Instagram webhook rejected: invalid signature");
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }
  const events = parseInstagramWebhook(rawBody);
  const transientMediaUrls = ephemeralInstagramMediaUrls(rawBody);
  if (!events.length) return NextResponse.json({ received: true, imported: 0 });

  const database = createAdminClient();
  const { data: connections, error: connectionError } = await database.from("connections").select("id,owner_id,account_name,account_identifier,token_metadata,encrypted_credentials").eq("provider", instagramConnector.id).eq("status", "connected");
  if (connectionError) {
    console.error("Instagram webhook connection lookup failed", {
      code: connectionError.code,
      message: connectionError.message,
      details: connectionError.details,
      hint: connectionError.hint,
    });
    return NextResponse.json({ error: "Instagram connections could not be loaded." }, { status: 500 });
  }

  let imported = 0;
  let failed = 0;
  const analyses: Array<{ ownerId: string; conversationId: string; messageId: string }> = [];
  const mediaImports: Array<{ job: MediaJob; urls: string[]; fallback: string }> = [];

  for (const event of events) {
    try {
      const connection = findInstagramWebhookConnection(connections ?? [], event.accountId);
      if (!connection) {
        failed += 1;
        console.warn("Instagram webhook account did not match a unique connection", {
          accountId: event.accountId,
          connectedAccounts: connections?.length ?? 0,
        });
        continue;
      }

      let profile: { name?: string; username?: string } | null = null;
      try {
        const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
        if (encryptionKey && connection.encrypted_credentials) {
          const credentials = decryptCredential<{ accessToken?: string }>(connection.encrypted_credentials, encryptionKey);
          if (credentials.accessToken) {
            const profileResponse = await fetch(instagramUserProfileUrl(event.participantId), { headers: { authorization: `Bearer ${credentials.accessToken}` }, signal: AbortSignal.timeout(10_000) });
            if (profileResponse.ok) profile = await profileResponse.json() as { name?: string; username?: string };
          }
        }
      } catch (error) {
        console.warn("Instagram sender profile lookup failed", { reason: error instanceof Error ? error.message : "unknown" });
      }

      const username = profile?.username?.trim() || null;
      const profileName = profile?.name?.trim() || (username ? `@${username}` : "");
      const identityKey = `instagram:${event.participantId}`;
      const resolved = await resolveOrCreateChannelPerson({
        database,
        ownerId: connection.owner_id,
        source: "instagram",
        externalIdentifier: identityKey,
        displayName: profileName,
        username,
        connectionId: connection.id,
        confidence: 0.7,
        contactAt: event.message.sentAt,
        identityMetadata: { instagram_scoped_id: event.participantId },
      });

      const conversationKey = `instagram:${connection.id}:${event.participantId}`;
      const { data: existingConversation, error: conversationLookupError } = await database.from("conversations").select("id").eq("owner_id", connection.owner_id).eq("source", "instagram").eq("external_conversation_id", conversationKey).maybeSingle();
      if (conversationLookupError) throw conversationLookupError;
      const conversationValues: Record<string, unknown> = {
        owner_id: connection.owner_id,
        person_id: resolved.personId,
        connection_id: connection.id,
        source: "instagram",
        external_conversation_id: conversationKey,
        title: `Instagram · ${connection.account_identifier ?? connection.account_name ?? "account"}`,
        conversation_type: "direct_message",
        last_message_at: event.message.sentAt,
        ...(event.message.direction === "in" ? { last_other_message_at: event.message.sentAt } : { last_user_message_at: event.message.sentAt }),
        updated_at: new Date().toISOString(),
      };
      const conversationResult = existingConversation?.id
        ? await database.from("conversations").update(conversationValues).eq("id", existingConversation.id).eq("owner_id", connection.owner_id).select("id").single()
        : await database.from("conversations").insert(conversationValues).select("id").single();
      if (conversationResult.error || !conversationResult.data) throw conversationResult.error ?? new Error("Instagram conversation could not be saved.");

      const { data: savedMessage, error: messageError } = await database.from("messages").upsert({
        owner_id: connection.owner_id,
        conversation_id: conversationResult.data.id,
        external_message_id: event.message.externalId,
        direction: event.message.direction,
        sender_identity_id: event.message.direction === "in" ? resolved.identityId : null,
        source: "instagram",
        body_text: event.message.body,
        sent_at: event.message.sentAt,
        attachment_count: event.message.attachmentCount,
        metadata: { ...event.message.providerMetadata, connection_id: connection.id },
        processed_at: null,
      }, { onConflict: "owner_id,source,external_message_id", ignoreDuplicates: true }).select("id,metadata").maybeSingle();
      if (messageError) throw messageError;
      if (savedMessage) {
        imported += 1;
        if (event.message.attachmentCount > 0) {
          const urls = transientMediaUrls.get(event.message.externalId) ?? [];
          if (urls.length) {
            mediaImports.push({
              job: { id: savedMessage.id, owner_id: connection.owner_id, connection_id: connection.id, provider: instagramConnector.id, provider_message_id: event.message.externalId, source_message_id: savedMessage.id, source_conversation_id: conversationResult.data.id, source_person_id: resolved.personId, attempts: 0 },
              urls,
              fallback: `instagram-${event.message.externalId}`,
            });
          } else try {
            await enqueueMediaAnalysis(database, {
              ownerId: connection.owner_id,
              connectionId: connection.id,
              provider: instagramConnector.id,
              source: "instagram",
              providerMessageId: event.message.externalId,
              messageId: savedMessage.id,
              conversationId: conversationResult.data.id,
              personId: resolved.personId,
              messageText: event.message.body,
              attachmentCount: event.message.attachmentCount,
              mediaTypes: Array.isArray(event.message.providerMetadata.attachment_types)
                ? event.message.providerMetadata.attachment_types.filter((type): type is string => typeof type === "string")
                : [],
            });
          } catch (mediaError) {
            console.error("Instagram media queue failed", { messageId: savedMessage.id, reason: mediaError instanceof Error ? mediaError.message : "unknown" });
          }
        }
        if (event.message.direction === "in") analyses.push({ ownerId: connection.owner_id, conversationId: conversationResult.data.id, messageId: savedMessage.id });
      }
    } catch (error) {
      failed += 1;
      console.error("Instagram webhook event ingestion failed", {
        accountId: event.accountId,
        participantId: event.participantId,
        messageId: event.message.externalId,
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  if (mediaImports.length || analyses.length) after(async () => {
    await Promise.allSettled(mediaImports.map(async (item) => {
      try {
        const attachments = await downloadEphemeralInstagramMedia(item.urls, item.fallback);
        await ingestTrustedMediaAttachments(database, item.job, attachments);
      } catch (error) {
        const { data: current } = await database.from("messages").select("metadata").eq("id", item.job.source_message_id!).eq("owner_id", item.job.owner_id).maybeSingle();
        const metadata = current?.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata) ? current.metadata : {};
        await database.from("messages").update({ metadata: { ...metadata, media_analysis_status: "failed", media_analysis: { reason: error instanceof Error ? error.message : "instagram_media_worker_failed" } } }).eq("id", item.job.source_message_id!).eq("owner_id", item.job.owner_id);
      }
    }));
    await Promise.allSettled(analyses.map((item) => analyzeIncomingInstagramMessage(item)));
  });
  return NextResponse.json({ received: true, imported, failed });
}
