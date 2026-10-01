import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptCredential, encryptCredential } from "@/lib/connectors/credential-crypto";
import { googleConfig } from "@/lib/connectors/google-oauth";
import { microsoftConfig } from "@/lib/connectors/microsoft-oauth";
import { googleGmailConnector } from "@/lib/connectors/google-gmail";
import { microsoftGraphConnector } from "@/lib/connectors/microsoft-graph";
import { analyzeStoredMedia } from "@/lib/media/analysis";
import { isDecorativeEmailSignatureAttachment } from "@/lib/vault/email-attachment-filter";

type Credentials = { accessToken: string; refreshToken?: string; tokenType?: string; scope?: string; expiresAt: string };
export type MediaJob = { id: string; owner_id: string; connection_id: string | null; provider: string; provider_message_id: string; source_message_id: string | null; source_conversation_id: string | null; source_person_id: string | null; attempts: number; source_type?: "email" | "instagram" | "whatsapp"; metadata?: unknown };
export type MediaAttachment = { filename: string; mimeType: string; bytes: Buffer };
const maxBytes = 100 * 1024 * 1024;
const textMimeTypes = new Set(["text/plain", "text/csv", "application/json"]);
const allowedMimeTypes = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
  "audio/mpeg", "audio/mp4", "audio/m4a", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm",
  "video/mp4", "video/webm", "video/quicktime",
  "text/plain", "text/csv", "application/json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

function metadata(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function appOrigin() { return process.env.NEXT_PUBLIC_APP_URL ?? "https://communication-intelligence.invalid"; }

async function refreshMicrosoft(credentials: Credentials) {
  if (Date.parse(credentials.expiresAt) > Date.now() + 60_000) return { token: credentials.accessToken, credentials, refreshed: false };
  if (!credentials.refreshToken) throw new Error("reconnect_required");
  const config = microsoftConfig(appOrigin());
  const response = await fetch(`https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: credentials.refreshToken, scope: microsoftGraphConnector.scopes.join(" ") }), signal: AbortSignal.timeout(15_000) });
  const body = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; token_type?: string; scope?: string; expires_in?: number };
  if (!response.ok || !body.access_token || !body.expires_in) throw new Error("reconnect_required");
  const next = { ...credentials, accessToken: body.access_token, refreshToken: body.refresh_token ?? credentials.refreshToken, tokenType: body.token_type ?? credentials.tokenType, scope: body.scope ?? credentials.scope, expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString() };
  return { token: next.accessToken, credentials: next, refreshed: true };
}

async function refreshGoogle(credentials: Credentials) {
  if (Date.parse(credentials.expiresAt) > Date.now() + 60_000) return { token: credentials.accessToken, credentials, refreshed: false };
  if (!credentials.refreshToken) throw new Error("reconnect_required");
  const config = googleConfig(appOrigin());
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: credentials.refreshToken }), signal: AbortSignal.timeout(15_000) });
  const body = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; token_type?: string; scope?: string; expires_in?: number };
  if (!response.ok || !body.access_token || !body.expires_in) throw new Error("reconnect_required");
  const next = { ...credentials, accessToken: body.access_token, refreshToken: body.refresh_token ?? credentials.refreshToken, tokenType: body.token_type ?? credentials.tokenType, scope: body.scope ?? credentials.scope, expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString() };
  return { token: next.accessToken, credentials: next, refreshed: true };
}

async function loadConnectionToken(database: SupabaseClient, job: MediaJob) {
  if (!job.connection_id) throw new Error("missing_connection");
  const { data: connection, error } = await database.from("connections").select("id,provider,encrypted_credentials,token_metadata").eq("id", job.connection_id).eq("owner_id", job.owner_id).eq("status", "connected").maybeSingle();
  if (error || !connection?.encrypted_credentials) throw new Error("connection_unavailable");
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!key) throw new Error("encryption_not_configured");
  const credentials = decryptCredential<Credentials>(connection.encrypted_credentials, key);
  const resolved = job.provider === microsoftGraphConnector.id ? await refreshMicrosoft(credentials) : job.provider === googleGmailConnector.id ? await refreshGoogle(credentials) : null;
  if (!resolved) throw new Error("unsupported_provider");
  if (resolved.refreshed) {
    const current = metadata(connection.token_metadata);
    const { error: updateError } = await database.from("connections").update({ encrypted_credentials: encryptCredential(resolved.credentials, key), token_metadata: { ...current, expires_at: resolved.credentials.expiresAt }, updated_at: new Date().toISOString() }).eq("id", connection.id).eq("owner_id", job.owner_id);
    if (updateError) throw new Error("credential_update_failed");
  }
  return resolved.token;
}

async function outlookAttachments(accessToken: string, messageId: string): Promise<MediaAttachment[]> {
  const url = new URL(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}/attachments`);
  url.searchParams.set("$select", "id,name,contentType,size,contentBytes");
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(response.status === 401 ? "reconnect_required" : `outlook_attachments_${response.status}`);
  const body = await response.json() as { value?: Array<{ name?: string; contentType?: string; contentBytes?: string; size?: number; isInline?: boolean; '@odata.type'?: string }> };
  return (body.value ?? []).flatMap((item) => {
    if (!item.contentBytes || item['@odata.type']?.includes("referenceAttachment") || isDecorativeEmailSignatureAttachment({ filename:item.name, mimeType:item.contentType, sizeBytes:item.size, isInline:item.isInline })) return [];
    const bytes = Buffer.from(item.contentBytes, "base64");
    return [{ filename: item.name?.trim() || "attachment", mimeType: item.contentType?.trim().toLowerCase() || "application/octet-stream", bytes }];
  });
}

type GmailPart = { mimeType?: string; filename?: string; headers?: Array<{name?:string;value?:string}>; body?: { attachmentId?: string; data?: string; size?:number }; parts?: GmailPart[] };
function gmailParts(part: GmailPart | undefined): GmailPart[] {
  if (!part) return [];
  return [(part.body?.attachmentId ? part : null), ...(part.parts ?? []).flatMap(gmailParts)].filter((value): value is GmailPart => Boolean(value));
}
async function gmailAttachments(accessToken: string, externalMessageId: string): Promise<MediaAttachment[]> {
  const messageId = externalMessageId.split(":").at(-1);
  if (!messageId) throw new Error("gmail_message_id_missing");
  const messageResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(25_000) });
  if (!messageResponse.ok) throw new Error(messageResponse.status === 401 ? "reconnect_required" : `gmail_message_${messageResponse.status}`);
  const message = await messageResponse.json() as { payload?: GmailPart };
  const parts = gmailParts(message.payload);
  const attachments: Array<MediaAttachment | null> = await Promise.all(parts.map(async (part): Promise<MediaAttachment | null> => {
    const attachmentId = part.body?.attachmentId;
    if (!attachmentId) throw new Error("gmail_attachment_id_missing");
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(25_000) });
    if (!response.ok) throw new Error(response.status === 401 ? "reconnect_required" : `gmail_attachment_${response.status}`);
    const body = await response.json() as { data?: string };
    const attachment = { filename: part.filename?.trim() || "attachment", mimeType: part.mimeType?.trim().toLowerCase() || "application/octet-stream", bytes: Buffer.from(body.data ?? "", "base64url") };
    const headers = new Map((part.headers ?? []).map((header) => [(header.name ?? "").toLowerCase(), header.value ?? ""]));
    return isDecorativeEmailSignatureAttachment({ filename:attachment.filename, mimeType:attachment.mimeType, sizeBytes:attachment.bytes.length, contentId:headers.get("content-id"), contentDisposition:headers.get("content-disposition") }) ? null : attachment;
  }));
  return attachments.filter((attachment): attachment is MediaAttachment => attachment !== null);
}

async function markMessage(database: SupabaseClient, job: MediaJob, state: "ready" | "blocked" | "failed", details: Record<string, unknown>) {
  if (!job.source_message_id) return;
  const { data } = await database.from("messages").select("metadata").eq("id", job.source_message_id).eq("owner_id", job.owner_id).maybeSingle();
  const current = metadata(data?.metadata);
  await database.from("messages").update({ metadata: { ...current, media_analysis_status: state, media_analysis: details } }).eq("id", job.source_message_id).eq("owner_id", job.owner_id);
}

async function storeAttachment(database: SupabaseClient, job: MediaJob, attachment: MediaAttachment) {
  if (!allowedMimeTypes.has(attachment.mimeType) || attachment.bytes.length > maxBytes || attachment.bytes.length === 0) return { state: "blocked" as const, reason: "unsupported_or_invalid_file" };
  const sha256 = createHash("sha256").update(attachment.bytes).digest("hex");
  const path = `${job.owner_id}/${sha256.slice(0, 2)}/${sha256}`;
  const { data: existing } = await database.from("vault_assets").select("id,summary,ai_decision").eq("owner_id", job.owner_id).eq("sha256", sha256).maybeSingle();
  if (existing?.id) {
    const decision = metadata(existing.ai_decision);
    const state = decision.analysis_state === "ready" ? "ready" as const : "blocked" as const;
    return { state, assetId: String(existing.id), summary: typeof existing.summary === "string" ? existing.summary : "Befintlig privat fil har kopplats till meddelandet." };
  }
  const uploaded = await database.storage.from("secure-vault").upload(path, attachment.bytes, { contentType: attachment.mimeType, upsert: false });
  if (uploaded.error) throw new Error("vault_upload_failed");
  const text = textMimeTypes.has(attachment.mimeType) ? attachment.bytes.toString("utf8").replace(/\u0000/g, "").slice(0, 12_000).trim() : "";
  const analyzed = text
    ? { state: "ready" as const, summary: text.slice(0, 1000), decision: { analysis_state: "ready", type: "text", extracted_text: text } }
    : await analyzeStoredMedia({ ownerId: job.owner_id, mimeType: attachment.mimeType, filename: attachment.filename, bytes: attachment.bytes });
  const { data: asset, error } = await database.from("vault_assets").insert({ owner_id: job.owner_id, asset_kind: attachment.mimeType.startsWith("image/") ? "image" : attachment.mimeType.startsWith("audio/") ? "audio" : attachment.mimeType.startsWith("video/") ? "video" : "document", title: attachment.filename, filename: attachment.filename, mime_type: attachment.mimeType, size_bytes: attachment.bytes.length, storage_path: path, sha256, source_type: job.source_type ?? "email", source_message_id: job.source_message_id, source_conversation_id: job.source_conversation_id, source_person_id: job.source_person_id, sensitivity: "personal", retention_status: "saved", summary: analyzed.summary, retention_reason: "Imported attachment", ai_decision: analyzed.decision, metadata: { provider: job.provider } }).select("id").single();
  if (error || !asset) throw new Error("vault_asset_save_failed");
  if (job.source_message_id) await database.from("attachments").insert({ owner_id: job.owner_id, message_id: job.source_message_id, filename: attachment.filename, mime_type: attachment.mimeType, size_bytes: attachment.bytes.length, storage_reference: `secure-vault/${path}`, metadata: { vault_asset_id: asset.id, sha256 } });
  return { state: analyzed.state, assetId: String(asset.id), summary: analyzed.summary };
}

export async function ingestTrustedMediaAttachments(database: SupabaseClient, job: MediaJob, attachments: MediaAttachment[]) {
  if (!attachments.length) {
    await markMessage(database, job, "ready", { asset_count: 0, reason: "no_retainable_attachment" });
    return { state: "ready" as const, assetCount: 0, assetIds: [] as string[] };
  }
  const results = await Promise.all(attachments.map((attachment) => storeAttachment(database, job, attachment)));
  const ready = results.length > 0 && results.every((result) => result.state === "ready");
  const blocked = results.some((result) => result.state === "blocked");
  await markMessage(database, job, ready ? "ready" : "blocked", { asset_count: results.length, summaries: results.map((result) => result.summary), reason: blocked ? "specialised_analysis_required" : undefined });
  return { state: ready ? "ready" as const : "blocked" as const, assetCount: results.length, assetIds: results.map((result) => result.assetId).filter((value): value is string => Boolean(value)) };
}

export async function processEmailMediaJob(database: SupabaseClient, job: MediaJob) {
  const { data: claimed } = await database.from("vault_ingestion_jobs").update({ state: "processing", attempts: job.attempts + 1, updated_at: new Date().toISOString() }).eq("id", job.id).eq("owner_id", job.owner_id).eq("state", "pending").select("id").maybeSingle();
  if (!claimed) return { processed: false, reason: "already_claimed" };
  try {
    const token = await loadConnectionToken(database, job);
    const attachments = job.provider === microsoftGraphConnector.id ? await outlookAttachments(token, job.provider_message_id) : await gmailAttachments(token, job.provider_message_id);
    const outcome = await ingestTrustedMediaAttachments(database, job, attachments);
    await database.from("vault_ingestion_jobs").update({ state: "done", last_error_code: null, updated_at: new Date().toISOString(), metadata: { ...metadata(job.metadata), stored_assets: outcome.assetIds, result: outcome.state } }).eq("id", job.id).eq("owner_id", job.owner_id);
    return { processed: true, state: outcome.state, assetCount: outcome.assetCount };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "media_worker_failed";
    await database.from("vault_ingestion_jobs").update({ state: "failed", last_error_code: reason.slice(0, 120), updated_at: new Date().toISOString() }).eq("id", job.id).eq("owner_id", job.owner_id);
    await markMessage(database, job, "failed", { reason });
    throw error;
  }
}

/**
 * Processes a deliberately small number of queued email attachments.
 *
 * This is shared by the protected manual endpoint and the existing Outlook
 * intelligence cron. Vercel Hobby permits only two cron jobs for this
 * project, so keeping the dispatcher here avoids adding a third schedule
 * that would make the deployment invalid.
 */
export async function processPendingEmailMediaJobs(database: SupabaseClient, limit = 1, ownerId?: string) {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 3));
  let query = database.from("vault_ingestion_jobs")
    .select("id,owner_id,connection_id,provider,provider_message_id,source_message_id,source_conversation_id,source_person_id,attempts,metadata")
    .eq("state", "pending")
    .in("provider", ["microsoft-graph", "gmail"])
    .order("created_at", { ascending: true });
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { data: jobs, error } = await query.limit(boundedLimit);

  if (error) throw new Error("media_queue_unavailable");

  const results = await Promise.allSettled((jobs ?? []).map((job) => processEmailMediaJob(database, job)));
  return {
    scanned: jobs?.length ?? 0,
    processed: results.filter((result) => result.status === "fulfilled" && result.value.processed).length,
    failed: results.filter((result) => result.status === "rejected").length,
  };
}
