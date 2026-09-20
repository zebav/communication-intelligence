import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { decryptCredential, encryptCredential } from "@/lib/connectors/credential-crypto";
import { googleConfig } from "@/lib/connectors/google-oauth";
import { microsoftConfig } from "@/lib/connectors/microsoft-oauth";
import { microsoftGraphConnector } from "@/lib/connectors/microsoft-graph";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const requestSchema = z.object({ connectionId: z.string().uuid(), cursor: z.string().max(12000).optional() });
type SyncCursor = { ownerId: string; connectionId: string; provider: string; cursor: string; issuedAt: string };
type StoredCredentials = { accessToken: string; refreshToken?: string; tokenType?: string; scope?: string; expiresAt: string };
type AddressBookContact = {
  id: string;
  displayName: string;
  emails: Array<{ value: string; label?: string }>;
  phones: Array<{ value: string; label?: string }>;
  organization?: string;
  jobTitle?: string;
  metadata?: Record<string, unknown>;
};

function cleanEmail(value?: string | null) {
  const email = value?.trim().toLowerCase() ?? "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function cleanPhone(value?: string | null) {
  const raw = value?.trim() ?? "";
  if (!raw) return "";
  const plus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return "";
  return plus ? `+${digits}` : digits;
}

function displayName(contact: AddressBookContact) {
  return contact.displayName.trim() || contact.emails[0]?.value || contact.phones[0]?.value || "Address book contact";
}

async function microsoftToken(credentials: StoredCredentials, origin: string) {
  if (new Date(credentials.expiresAt).getTime() > Date.now() + 60_000) return { token: credentials.accessToken, credentials, refreshed: false };
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
  const result = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string; scope?: string };
  if (!result.access_token || !result.expires_in) throw new Error("reconnect_required");
  const next = {
    ...credentials,
    accessToken: result.access_token,
    refreshToken: result.refresh_token ?? credentials.refreshToken,
    tokenType: result.token_type ?? credentials.tokenType,
    scope: result.scope ?? credentials.scope,
    expiresAt: new Date(Date.now() + result.expires_in * 1000).toISOString(),
  };
  return { token: result.access_token, credentials: next, refreshed: true };
}

async function googleToken(credentials: StoredCredentials, origin: string) {
  if (new Date(credentials.expiresAt).getTime() > Date.now() + 60_000) return { token: credentials.accessToken, credentials, refreshed: false };
  if (!credentials.refreshToken) throw new Error("reconnect_required");
  const config = googleConfig(origin);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("reconnect_required");
  const result = await response.json() as { access_token?: string; expires_in?: number; token_type?: string; scope?: string };
  if (!result.access_token || !result.expires_in) throw new Error("reconnect_required");
  const next = {
    ...credentials,
    accessToken: result.access_token,
    tokenType: result.token_type ?? credentials.tokenType,
    scope: result.scope ?? credentials.scope,
    expiresAt: new Date(Date.now() + result.expires_in * 1000).toISOString(),
  };
  return { token: result.access_token, credentials: next, refreshed: true };
}

async function loadMicrosoftContacts(token: string, cursor?: string) {
  const url = cursor || "https://graph.microsoft.com/v1.0/me/contacts?$select=id,displayName,givenName,surname,emailAddresses,mobilePhone,businessPhones,homePhones,companyName,jobTitle&$top=25";
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12_000) });
  if (response.status === 403) throw new Error("contacts_permission_required");
  if (!response.ok) throw new Error(`microsoft_contacts_${response.status}`);
  const data = await response.json() as {
    value?: Array<{
      id?: string; displayName?: string; givenName?: string; surname?: string;
      emailAddresses?: Array<{ address?: string; name?: string }>;
      mobilePhone?: string; businessPhones?: string[]; homePhones?: string[];
      companyName?: string; jobTitle?: string;
    }>;
    "@odata.nextLink"?: string;
  };
  const items: AddressBookContact[] = [];
  for (const item of data.value ?? []) {
    if (!item.id) continue;
    const emails = (item.emailAddresses ?? []).map((entry) => ({ value: cleanEmail(entry.address), label: entry.name })).filter((entry) => entry.value);
    const phones = [
      item.mobilePhone ? { value: cleanPhone(item.mobilePhone), label: "mobile" } : null,
      ...(item.businessPhones ?? []).map((value) => ({ value: cleanPhone(value), label: "business" })),
      ...(item.homePhones ?? []).map((value) => ({ value: cleanPhone(value), label: "home" })),
    ].filter((entry): entry is { value: string; label: string } => Boolean(entry?.value));
    items.push({
      id: item.id,
      displayName: item.displayName?.trim() || [item.givenName, item.surname].filter(Boolean).join(" "),
      emails,
      phones,
      organization: item.companyName?.trim() || undefined,
      jobTitle: item.jobTitle?.trim() || undefined,
    });
  }
  return { contacts: items, cursor: data["@odata.nextLink"] ?? null };
}

async function loadGoogleContacts(token: string, cursor?: string) {
  const url = new URL("https://people.googleapis.com/v1/people/me/connections");
  url.searchParams.set("pageSize", "50");
  url.searchParams.set("personFields", "names,emailAddresses,phoneNumbers,organizations,metadata");
  if (cursor) url.searchParams.set("pageToken", cursor);
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12_000) });
  if (response.status === 403) throw new Error("contacts_permission_required");
  if (!response.ok) throw new Error(`google_contacts_${response.status}`);
  const data = await response.json() as {
    connections?: Array<{
      resourceName?: string;
      etag?: string;
      names?: Array<{ displayName?: string }>;
      emailAddresses?: Array<{ value?: string; type?: string }>;
      phoneNumbers?: Array<{ value?: string; type?: string }>;
      organizations?: Array<{ name?: string; title?: string }>;
    }>;
    nextPageToken?: string;
  };
  const items: AddressBookContact[] = [];
  for (const item of data.connections ?? []) {
    if (!item.resourceName) continue;
    const org = item.organizations?.find((value) => value.name || value.title);
    items.push({
      id: item.resourceName,
      displayName: item.names?.find((value) => value.displayName)?.displayName?.trim() ?? "",
      emails: (item.emailAddresses ?? []).map((entry) => ({ value: cleanEmail(entry.value), label: entry.type })).filter((entry) => entry.value),
      phones: (item.phoneNumbers ?? []).map((entry) => ({ value: cleanPhone(entry.value), label: entry.type })).filter((entry) => entry.value),
      organization: org?.name?.trim() || undefined,
      jobTitle: org?.title?.trim() || undefined,
      metadata: { etag: item.etag ?? null },
    });
  }
  return { contacts: items, cursor: data.nextPageToken ?? null };
}

async function resolvePerson(db: ReturnType<typeof createAdminClient>, ownerId: string, contact: AddressBookContact, source: { provider: string; connectionId: string }, preferredPersonId?: string) {
  const emails = [...new Set(contact.emails.map((entry) => cleanEmail(entry.value)).filter(Boolean))];
  const phones = [...new Set(contact.phones.map((entry) => cleanPhone(entry.value)).filter(Boolean))];
  const candidates = new Set<string>();
  if (preferredPersonId) candidates.add(preferredPersonId);

  if (emails.length) {
    const { data } = await db.from("identities").select("person_id").eq("owner_id", ownerId).eq("source", "email").in("external_identifier", emails);
    for (const row of data ?? []) candidates.add(row.person_id);
  }
  if (phones.length) {
    const { data } = await db.from("person_contact_points").select("person_id").eq("owner_id", ownerId).eq("kind", "phone").in("normalized_value", phones);
    for (const row of data ?? []) candidates.add(row.person_id);
  }

  let personId = candidates.size === 1 ? [...candidates][0] : "";
  const identityConflict = candidates.size > 1;
  if (!personId) {
    const { data, error } = await db.from("people").insert({
      owner_id: ownerId,
      display_name: displayName(contact),
      entity_type: "person",
      relationship_type: "unknown",
    }).select("id").single();
    if (error || !data) throw error ?? new Error("person_create_failed");
    personId = data.id;
  }

  const { data: current } = await db.from("people").select("display_name,organization,professional_specialty").eq("id", personId).eq("owner_id", ownerId).maybeSingle();
  if (current) {
    await db.from("people").update({
      display_name: current.display_name === "Unknown person" || current.display_name?.startsWith("Email contact ") ? displayName(contact) : current.display_name,
      organization: current.organization || contact.organization || null,
      professional_specialty: current.professional_specialty || contact.jobTitle || null,
      updated_at: new Date().toISOString(),
    }).eq("id", personId).eq("owner_id", ownerId);
  }

  for (const email of emails) {
    const { data: existing } = await db.from("identities").select("id,person_id").eq("owner_id", ownerId).eq("source", "email").eq("external_identifier", email).maybeSingle();
    if (!existing) await db.from("identities").insert({
      owner_id: ownerId, person_id: personId, source: "email", external_identifier: email,
      verified_match: !identityConflict, confidence: identityConflict ? 0.5 : 1,
      metadata: { address_book: true },
    });
  }

  for (const phone of phones) {
    const original = contact.phones.find((entry) => cleanPhone(entry.value) === phone);
    await db.from("person_contact_points").upsert({
      owner_id: ownerId, person_id: personId, kind: "phone", value: original?.value ?? phone,
      normalized_value: phone, label: original?.label ?? null, verified: !identityConflict,
      source_provider: source.provider, source_connection_id: source.connectionId, metadata: { identity_conflict: identityConflict },
      updated_at: new Date().toISOString(),
    }, { onConflict: "owner_id,kind,normalized_value", ignoreDuplicates: true });
  }
  for (const email of emails) {
    const original = contact.emails.find((entry) => cleanEmail(entry.value) === email);
    await db.from("person_contact_points").upsert({
      owner_id: ownerId, person_id: personId, kind: "email", value: original?.value ?? email,
      normalized_value: email, label: original?.label ?? null, verified: !identityConflict,
      source_provider: source.provider, source_connection_id: source.connectionId, metadata: { identity_conflict: identityConflict },
      updated_at: new Date().toISOString(),
    }, { onConflict: "owner_id,kind,normalized_value", ignoreDuplicates: true });
  }
  return { personId, identityConflict };
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a connected account." }, { status: 400 });

  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "Your session has expired. Sign in again." }, { status: 401 });
  const { data: assurance } = await session.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.json({ error: "Two-factor authentication is required." }, { status: 403 });

  const db = createAdminClient();
  const { data: connection } = await db.from("connections")
    .select("id,provider,account_identifier,encrypted_credentials,token_metadata")
    .eq("id", parsed.data.connectionId).eq("owner_id", user.id).eq("status", "connected").maybeSingle();
  if (!connection?.encrypted_credentials || !["gmail","microsoft-graph"].includes(connection.provider)) {
    return NextResponse.json({ error: "The selected Google or Microsoft account is not connected." }, { status: 409 });
  }

  const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!encryptionKey) return NextResponse.json({ error: "Server encryption is not configured." }, { status: 500 });

  try {
    const stored = decryptCredential<StoredCredentials>(connection.encrypted_credentials, encryptionKey);
    const authorized = connection.provider === "gmail"
      ? await googleToken(stored, request.nextUrl.origin)
      : await microsoftToken(stored, request.nextUrl.origin);
    if (authorized.refreshed) {
      await db.from("connections").update({
        encrypted_credentials: encryptCredential(authorized.credentials, encryptionKey),
        token_metadata: { ...((connection.token_metadata as Record<string, unknown> | null) ?? {}), expires_at: authorized.credentials.expiresAt },
        updated_at: new Date().toISOString(),
      }).eq("id", connection.id).eq("owner_id", user.id);
    }

    const metadata = (connection.token_metadata as Record<string, unknown> | null) ?? {};
    let providerCursor: string | undefined;
    const resumeToken = parsed.data.cursor
      ?? (typeof metadata.contacts_resume_token === "string" ? metadata.contacts_resume_token : undefined);
    if (resumeToken) {
      let decoded: SyncCursor;
      try {
        decoded = decryptCredential<SyncCursor>(resumeToken, encryptionKey);
      } catch {
        return NextResponse.json({ error: "The contact sync cursor is invalid. Start the sync again." }, { status: 400 });
      }
      const issuedAt = new Date(decoded.issuedAt).getTime();
      if (
        decoded.ownerId !== user.id ||
        decoded.connectionId !== connection.id ||
        decoded.provider !== connection.provider ||
        !decoded.cursor ||
        !Number.isFinite(issuedAt) ||
        Date.now() - issuedAt > 30 * 60_000
      ) {
        return NextResponse.json({ error: "The contact sync cursor has expired. Start the sync again." }, { status: 400 });
      }
      providerCursor = decoded.cursor;
    }
    const page = connection.provider === "gmail"
      ? await loadGoogleContacts(authorized.token, providerCursor)
      : await loadMicrosoftContacts(authorized.token, providerCursor);
    const contacts = page.contacts;

    let created = 0;
    let linked = 0;
    let conflicts = 0;
    for (let offset = 0; offset < contacts.length; offset += 5) {
      const outcomes = await Promise.all(contacts.slice(offset, offset + 5).map(async (contact) => {
        if (!contact.emails.length && !contact.phones.length) return { created: 0, linked: 0, conflicts: 0 };
        const { data: existingExternal } = await db.from("external_contacts").select("id,person_id")
          .eq("owner_id", user.id).eq("connection_id", connection.id).eq("provider_contact_id", contact.id).maybeSingle();
        const resolved = await resolvePerson(
          db,
          user.id,
          contact,
          { provider: connection.provider, connectionId: connection.id },
          existingExternal?.person_id,
        );
        const personId = resolved.personId;
        const identityConflict = resolved.identityConflict;
        const values = {
          owner_id: user.id,
          connection_id: connection.id,
          provider: connection.provider,
          provider_contact_id: contact.id,
          person_id: personId,
          display_name: displayName(contact),
          etag: typeof contact.metadata?.etag === "string" ? contact.metadata.etag : null,
          raw_metadata: {
            emails: contact.emails,
            phones: contact.phones,
            organization: contact.organization ?? null,
            job_title: contact.jobTitle ?? null,
            identity_conflict: identityConflict,
          },
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (existingExternal?.id) {
          const { error } = await db.from("external_contacts").update(values).eq("id", existingExternal.id).eq("owner_id", user.id);
          if (error) throw error;
          return { created: 0, linked: 0, conflicts: identityConflict ? 1 : 0 };
        }
        const { error } = await db.from("external_contacts").insert(values);
        if (error) throw error;
        return { created: 1, linked: identityConflict ? 0 : 1, conflicts: identityConflict ? 1 : 0 };
      }));
      created += outcomes.reduce((sum, item) => sum + item.created, 0);
      linked += outcomes.reduce((sum, item) => sum + item.linked, 0);
      conflicts += outcomes.reduce((sum, item) => sum + item.conflicts, 0);
    }

    const complete = !page.cursor;
    const previousProcessed = parsed.data.cursor ? Number(metadata.contacts_processed_count ?? 0) : 0;
    const processedTotal = previousProcessed + contacts.length;
    const nextCursor = page.cursor
      ? encryptCredential({
          ownerId: user.id,
          connectionId: connection.id,
          provider: connection.provider,
          cursor: page.cursor,
          issuedAt: new Date().toISOString(),
        } satisfies SyncCursor, encryptionKey)
      : null;

    const { error: metadataError } = await db.from("connections").update({
      token_metadata: {
        ...metadata,
        expires_at: authorized.credentials.expiresAt,
        contacts_sync_started_at: resumeToken ? metadata.contacts_sync_started_at ?? new Date().toISOString() : new Date().toISOString(),
        contacts_processed_count: complete ? 0 : processedTotal,
        contacts_resume_token: complete ? null : nextCursor,
        contacts_last_synced_at: complete ? new Date().toISOString() : metadata.contacts_last_synced_at ?? null,
        contacts_count: complete ? processedTotal : metadata.contacts_count ?? null,
      },
      updated_at: new Date().toISOString(),
    }).eq("id", connection.id).eq("owner_id", user.id);
    if (metadataError) console.error("address_book_sync_metadata_failed", { provider: connection.provider, reason: metadataError.message });

    await db.from("audit_logs").insert({
      owner_id: user.id, actor_id: user.id, actor_type: "user", action: "contacts.address_book_sync_page",
      object_type: "connection", object_id: connection.id, source: "email",
      new_value: { provider: connection.provider, fetched: contacts.length, created, linked, conflicts, complete },
    });

    return NextResponse.json({ success: true, fetched: contacts.length, created, linked, conflicts, complete, cursor: nextCursor });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("address_book_sync_failed", { provider: connection.provider, reason });
    if (reason === "contacts_permission_required" || reason === "reconnect_required") {
      return NextResponse.json({ error: "Reconnect this account to grant read-only Contacts access.", reconnectRequired: true }, { status: 409 });
    }
    return NextResponse.json({ error: "The address book could not be synchronized." }, { status: 500 });
  }
}
