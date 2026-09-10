import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { decryptCredential, encryptCredential } from "@/lib/connectors/credential-crypto";
import { microsoftConfig } from "@/lib/connectors/microsoft-oauth";
import { microsoftGraphConnector } from "@/lib/connectors/microsoft-graph";
import { googleConfig } from "@/lib/connectors/google-oauth";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

type StoredCredentials = { accessToken: string; refreshToken?: string; tokenType?: string; scope?: string; expiresAt: string };
type Contact = { address: string; name: string; lastSeenAt?: string };
const requestSchema = z.object({ connectionId: z.string().uuid() });

function jsonError(message: string, status = 500) { return NextResponse.json({ error: message }, { status }); }
function cleanAddress(value?: string) { return value?.trim().toLowerCase() ?? ""; }
function gmailAddress(value: string) { return cleanAddress(value.match(/<([^>]+)>/)?.[1] ?? value.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0]); }
function gmailName(value: string, address: string) { return value.replace(/<[^>]+>/, "").replace(/^"|"$/g, "").trim() || address; }
function contactEntity(contact: Contact): "person" | "organization" | "automated" | "unknown" {
  const local = contact.address.split("@")[0] ?? ""; const value = `${contact.name} ${local}`.toLowerCase();
  if (/no.?reply|do.?not.?reply|notification|newsletter|mailer|automated|alerts?|updates?|marketing/.test(value)) return "automated";
  if (/\b(team|support|service|sales|billing|accounts?|info|office|company|group|network|conference|institute|university|bank|hotel|booking|business)\b|\b(ab|ltd|inc|llc)\b/.test(value)) return "organization";
  const words = contact.name.trim().split(/\s+/).filter(Boolean);
  if (contact.name !== contact.address && words.length >= 2 && words.length <= 5 && !/[|<>]/.test(contact.name)) return "person";
  return "unknown";
}

async function microsoftToken(credentials: StoredCredentials, origin: string) {
  if (new Date(credentials.expiresAt).getTime() > Date.now() + 60_000) return { token: credentials.accessToken, credentials, refreshed: false };
  if (!credentials.refreshToken) throw new Error("reconnect_required");
  const config = microsoftConfig(origin);
  const response = await fetch(`https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: credentials.refreshToken, scope: microsoftGraphConnector.scopes.join(" ") }), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("reconnect_required");
  const result = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string; scope?: string };
  if (!result.access_token || !result.expires_in) throw new Error("reconnect_required");
  const next = { ...credentials, accessToken: result.access_token, refreshToken: result.refresh_token ?? credentials.refreshToken, tokenType: result.token_type ?? credentials.tokenType, scope: result.scope ?? credentials.scope, expiresAt: new Date(Date.now() + result.expires_in * 1000).toISOString() };
  return { token: result.access_token, credentials: next, refreshed: true };
}

async function googleToken(credentials: StoredCredentials, origin: string) {
  if (new Date(credentials.expiresAt).getTime() > Date.now() + 60_000) return { token: credentials.accessToken, credentials, refreshed: false };
  if (!credentials.refreshToken) throw new Error("reconnect_required");
  const config = googleConfig(origin);
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: credentials.refreshToken }), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("reconnect_required");
  const result = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string; scope?: string };
  if (!result.access_token || !result.expires_in) throw new Error("reconnect_required");
  const next = { ...credentials, accessToken: result.access_token, refreshToken: result.refresh_token ?? credentials.refreshToken, tokenType: result.token_type ?? credentials.tokenType, scope: result.scope ?? credentials.scope, expiresAt: new Date(Date.now() + result.expires_in * 1000).toISOString() };
  return { token: result.access_token, credentials: next, refreshed: true };
}

async function discoverMicrosoft(token: string, cursor?: string) {
  const contacts = new Map<string, Contact>();
  let url: string | undefined = cursor || "https://graph.microsoft.com/v1.0/me/messages?$select=from,toRecipients,ccRecipients,sentDateTime,receivedDateTime&$top=100&$orderby=sentDateTime%20desc";
  let pages = 0;
  while (url && pages < 3) {
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`microsoft_history_${response.status}`);
    const data = await response.json() as { value?: Array<{ from?: { emailAddress?: { address?: string; name?: string } }; toRecipients?: Array<{ emailAddress?: { address?: string; name?: string } }>; ccRecipients?: Array<{ emailAddress?: { address?: string; name?: string } }>; sentDateTime?: string; receivedDateTime?: string }>; "@odata.nextLink"?: string };
    for (const message of data.value ?? []) for (const item of [message.from, ...(message.toRecipients ?? []), ...(message.ccRecipients ?? [])]) {
      const address = cleanAddress(item?.emailAddress?.address); if (!address) continue;
      contacts.set(address, { address, name: item?.emailAddress?.name?.trim() || address, lastSeenAt: message.sentDateTime ?? message.receivedDateTime });
    }
    url = data["@odata.nextLink"]; pages += 1;
  }
  return { contacts: [...contacts.values()], cursor: url };
}

async function discoverGoogle(token: string, cursor?: string) {
  const pageToken = cursor ? `&pageToken=${encodeURIComponent(cursor)}` : "";
  const listResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=75&q=newer_than%3A5y${pageToken}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (!listResponse.ok) throw new Error(`google_history_${listResponse.status}`);
  const list = await listResponse.json() as { messages?: Array<{ id?: string }>; nextPageToken?: string };
  const contacts = new Map<string, Contact>();
  const items = (list.messages ?? []).slice(0, 75);
  for (let offset = 0; offset < items.length; offset += 15) {
    const messages = await Promise.all(items.slice(offset, offset + 15).map(async (item) => {
      if (!item.id) return null;
      const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
      return response.ok ? response.json() as Promise<{ internalDate?: string; payload?: { headers?: Array<{ name?: string; value?: string }> } }> : null;
    }));
    for (const message of messages) for (const header of message?.payload?.headers ?? []) if (["from", "to", "cc"].includes(header.name?.toLowerCase() ?? "")) for (const value of (header.value ?? "").split(",")) {
        const address = gmailAddress(value); if (!address) continue;
        contacts.set(address, { address, name: gmailName(value, address), lastSeenAt: message?.internalDate ? new Date(Number(message.internalDate)).toISOString() : undefined });
      }
  }
  return { contacts: [...contacts.values()], cursor: list.nextPageToken };
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return jsonError("Invalid request origin.", 403);
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Choose a connected email account.", 400);
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return jsonError("Your session has expired. Sign in again.", 401);
  const { data: assurance } = await session.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return jsonError("Two-factor authentication is required.", 403);
  const database = session;
  const { data: connection } = await database.from("connections").select("id,provider,account_identifier,encrypted_credentials,token_metadata").eq("id", parsed.data.connectionId).eq("owner_id", user.id).eq("status", "connected").maybeSingle();
  if (!connection?.encrypted_credentials || !["microsoft-graph", "gmail"].includes(connection.provider)) return jsonError("The selected email account is not connected.", 409);
  const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!encryptionKey) return jsonError("The server encryption key is not configured.");
  try {
    const stored = decryptCredential<StoredCredentials>(connection.encrypted_credentials, encryptionKey);
    const authorized = connection.provider === "gmail" ? await googleToken(stored, request.nextUrl.origin) : await microsoftToken(stored, request.nextUrl.origin);
    if (authorized.refreshed) await database.from("connections").update({ encrypted_credentials: encryptCredential(authorized.credentials, encryptionKey), token_metadata: { ...(connection.token_metadata as object ?? {}), expires_at: authorized.credentials.expiresAt }, updated_at: new Date().toISOString() }).eq("id", connection.id).eq("owner_id", user.id);
    const metadata = (connection.token_metadata as Record<string, unknown> | null) ?? {};
    const cursorKey = connection.provider === "gmail" ? "contact_discovery_page_token" : "contact_discovery_next_link";
    const cursor = typeof metadata[cursorKey] === "string" ? metadata[cursorKey] as string : undefined;
    const discovery = connection.provider === "gmail" ? await discoverGoogle(authorized.token, cursor) : await discoverMicrosoft(authorized.token, cursor);
    const discovered = discovery.contacts;
    await database.from("connections").update({ token_metadata: { ...metadata, expires_at: authorized.credentials.expiresAt, [cursorKey]: discovery.cursor ?? null, contact_discovery_completed_at: discovery.cursor ? null : new Date().toISOString() }, updated_at: new Date().toISOString() }).eq("id", connection.id).eq("owner_id", user.id);
    const ownAddress = cleanAddress(connection.account_identifier);
    let created = 0; let existing = 0;
    const createdContacts: Array<{ name: string; address: string }> = [];
    const candidates = discovered.filter((item) => item.address !== ownAddress);
    for (let offset = 0; offset < candidates.length; offset += 10) {
      await Promise.all(candidates.slice(offset, offset + 10).map(async (contact) => {
        const { data: identity } = await database.from("identities").select("id,person_id").eq("owner_id", user.id).eq("source", "email").eq("external_identifier", contact.address).maybeSingle();
        const entityType = contactEntity(contact);
        if (identity) { existing += 1; await database.from("people").update({ ...(contact.lastSeenAt ? { last_contact_at: contact.lastSeenAt } : {}), entity_type: entityType }).eq("id", identity.person_id).eq("owner_id", user.id).eq("entity_type", "unknown"); return; }
        const { data: person, error: personError } = await database.from("people").insert({ owner_id: user.id, display_name: contact.name, entity_type: entityType, relationship_type: "unknown", last_contact_at: contact.lastSeenAt ?? new Date().toISOString() }).select("id").single();
        if (personError || !person) return;
        const { error: identityError } = await database.from("identities").insert({ owner_id: user.id, person_id: person.id, source: "email", external_identifier: contact.address, metadata: { provider: connection.provider, discovered_from_history: true }, verified_match: true, confidence: 1 });
        if (identityError) { await database.from("people").delete().eq("id", person.id); return; }
        created += 1; createdContacts.push({ name: contact.name, address: contact.address });
      }));
    }
    await database.from("audit_logs").insert({ owner_id: user.id, actor_id: user.id, action: "contacts.history_discovered", object_type: "connection", object_id: connection.id, source: "email", actor_type: "user", new_value: { provider: connection.provider, scanned: discovered.length, created, existing } });
    return NextResponse.json({ success: true, scanned: discovered.length, created, existing, createdContacts: createdContacts.slice(0, 20), moreAvailable: Boolean(discovery.cursor) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("Historical contact discovery failed", { provider: connection.provider, reason });
    if (reason === "reconnect_required") return jsonError("Reconnect this email account before scanning its history.", 409);
    return jsonError("Historical contacts could not be discovered from this account. Try again.");
  }
}
