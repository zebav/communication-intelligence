import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptCredential, encryptCredential } from "@/lib/connectors/credential-crypto";
import { storeVaultFile } from "@/lib/vault/vault-service";

type Database = Pick<SupabaseClient, "from">;
type Credentials = { accessToken: string; refreshToken: string; expiresAt?: string; tokenType?: string; scope?: string };
type PickerSession = { id?: string; name?: string; pickerUri?: string; pollingConfig?: { pollInterval?: string } };
type PickerItem = { id?: string; mediaFile?: { baseUrl?: string; mimeType?: string; filename?: string }; baseUrl?: string; mimeType?: string; filename?: string };

function sessionId(value: PickerSession) { return value.id ?? value.name ?? ""; }
function requestHeaders(accessToken: string) { return { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }; }

async function accessTokenFor(ownerId: string, db: Database) {
  const { data: connection, error } = await db.from("connections").select("id,encrypted_credentials").eq("owner_id", ownerId).eq("provider", "google-photos").eq("status", "connected").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error || !connection?.encrypted_credentials) throw new Error("Google Foto är inte anslutet.");
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!key) throw new Error("Dokumentanslutningen saknar säker serverkonfiguration.");
  const credentials = decryptCredential<Credentials>(connection.encrypted_credentials, key);
  if (!credentials.accessToken || !credentials.refreshToken) throw new Error("Google Foto behöver anslutas igen.");
  const expiresSoon = !credentials.expiresAt || Date.parse(credentials.expiresAt) < Date.now() + 60_000;
  if (!expiresSoon) return credentials.accessToken;
  const clientId = process.env.GOOGLE_CLIENT_ID; const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google Foto behöver konfigureras på servern.");
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: credentials.refreshToken, grant_type: "refresh_token" }), signal: AbortSignal.timeout(15_000) });
  const next = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; token_type?: string; scope?: string };
  if (!response.ok || !next.access_token || !next.expires_in) throw new Error("Google Foto behöver anslutas igen.");
  const refreshed: Credentials = { ...credentials, accessToken: next.access_token, expiresAt: new Date(Date.now() + next.expires_in * 1000).toISOString(), tokenType: next.token_type ?? credentials.tokenType, scope: next.scope ?? credentials.scope };
  await db.from("connections").update({ encrypted_credentials: encryptCredential(refreshed, key), updated_at: new Date().toISOString(), health_status: "healthy" }).eq("id", connection.id);
  return refreshed.accessToken;
}

export async function startGooglePhotosPicker(ownerId: string, db: Database) {
  const accessToken = await accessTokenFor(ownerId, db);
  const response = await fetch("https://photospicker.googleapis.com/v1/sessions", { method: "POST", headers: requestHeaders(accessToken), body: JSON.stringify({ pickingConfig: { maxItemCount: "10" } }), signal: AbortSignal.timeout(15_000) });
  const session = await response.json().catch(() => ({})) as PickerSession;
  const id = sessionId(session);
  if (!response.ok || !id || !session.pickerUri) {
    console.error("google_photos_picker_session_failed", { status: response.status, hasSessionId: Boolean(id), hasPickerUri: Boolean(session.pickerUri) });
    throw new Error(response.status === 403 ? "Google Foto saknar behörighet för bildväljaren. Anslut tjänsten igen." : "Google Foto kunde inte öppna bildväljaren.");
  }
  return { sessionId: id, pickerUri: session.pickerUri, pollAfter: session.pollingConfig?.pollInterval ?? "5s" };
}

export async function importGooglePhotosPickerSelection(ownerId: string, db: Database, id: string) {
  const accessToken = await accessTokenFor(ownerId, db);
  const statusResponse = await fetch(`https://photospicker.googleapis.com/v1/${id}`, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
  const status = await statusResponse.json().catch(() => ({})) as { mediaItemsSet?: boolean };
  if (!statusResponse.ok) throw new Error("Google Foto-valet kunde inte kontrolleras.");
  if (!status.mediaItemsSet) return { status: "waiting" as const, imported: 0, skipped: 0 };
  const listResponse = await fetch(`https://photospicker.googleapis.com/v1/mediaItems?sessionId=${encodeURIComponent(id)}&pageSize=10`, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
  const body = await listResponse.json().catch(() => ({})) as { mediaItems?: PickerItem[] };
  if (!listResponse.ok) throw new Error("De valda bilderna kunde inte hämtas från Google Foto.");
  let imported = 0; let skipped = 0;
  for (const item of body.mediaItems ?? []) {
    const baseUrl = item.mediaFile?.baseUrl ?? item.baseUrl;
    const mimeType = item.mediaFile?.mimeType ?? item.mimeType ?? "";
    const filename = item.mediaFile?.filename ?? item.filename ?? "google-photo";
    if (!baseUrl || !mimeType.startsWith("image/")) { skipped += 1; continue; }
    const media = await fetch(`${baseUrl}=w2048-h2048`, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000) });
    const contentLength = Number(media.headers.get("content-length") ?? 0);
    if (!media.ok || (contentLength && contentLength > 25 * 1024 * 1024)) { skipped += 1; continue; }
    const bytes = new Uint8Array(await media.arrayBuffer());
    if (bytes.length > 25 * 1024 * 1024) { skipped += 1; continue; }
    await storeVaultFile({ ownerId, bytes, filename, mimeType, sourceType: "google_photos", forceKind: "image", forceSave: true, provenance: { externalOrigin: "google_photos" } });
    imported += 1;
  }
  await fetch(`https://photospicker.googleapis.com/v1/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
  return { status: "imported" as const, imported, skipped };
}
