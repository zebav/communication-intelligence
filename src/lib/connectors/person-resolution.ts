import type { SupabaseClient } from "@supabase/supabase-js";

export type ChannelPersonResolutionInput = {
  database: SupabaseClient;
  ownerId: string;
  source: "instagram" | "whatsapp" | "email" | "messenger" | "tinder" | "tiktok" | "linkedin" | "manual";
  externalIdentifier: string;
  displayName?: string | null;
  username?: string | null;
  profileUrl?: string | null;
  connectionId?: string | null;
  identityMetadata?: Record<string, unknown>;
  confidence?: number;
  contactAt?: string;
};

export type ChannelPersonResolution = {
  personId: string;
  identityId: string;
  createdPerson: boolean;
  createdIdentity: boolean;
};

function placeholderPrefix(source: ChannelPersonResolutionInput["source"]) {
  return `${source.charAt(0).toUpperCase()}${source.slice(1)} contact `;
}

function cleanDisplayName(value?: string | null) {
  const name = value?.trim();
  return name && name.length <= 200 ? name : "";
}

export async function resolveOrCreateChannelPerson(input: ChannelPersonResolutionInput): Promise<ChannelPersonResolution> {
  const externalIdentifier = input.externalIdentifier.trim();
  if (!externalIdentifier) throw new Error("A channel identity requires an external identifier.");
  const now = input.contactAt ?? new Date().toISOString();
  const displayName = cleanDisplayName(input.displayName);
  const username = input.username?.trim() || null;
  const profileUrl = input.profileUrl?.trim() || null;
  const metadata = { ...(input.identityMetadata ?? {}), ...(input.connectionId ? { connection_id: input.connectionId } : {}) };

  const { data: existingIdentity, error: identityLookupError } = await input.database
    .from("identities")
    .select("id,person_id,username,profile_url,metadata")
    .eq("owner_id", input.ownerId)
    .eq("source", input.source)
    .eq("external_identifier", externalIdentifier)
    .maybeSingle();
  if (identityLookupError) throw identityLookupError;

  if (existingIdentity) {
    const { data: person, error: personLookupError } = await input.database
      .from("people")
      .select("id,display_name,first_contact_at,last_contact_at")
      .eq("id", existingIdentity.person_id)
      .eq("owner_id", input.ownerId)
      .maybeSingle();
    if (personLookupError) throw personLookupError;
    if (!person) throw new Error("The channel identity points to a missing person.");

    const shouldReplacePlaceholder = displayName && (person.display_name?.startsWith(placeholderPrefix(input.source)) || person.display_name === "Unknown person");
    const { error: personUpdateError } = await input.database
      .from("people")
      .update({
        ...(shouldReplacePlaceholder ? { display_name: displayName } : {}),
        first_contact_at: person.first_contact_at ?? now,
        last_contact_at: !person.last_contact_at || String(person.last_contact_at) < now ? now : person.last_contact_at,
        updated_at: new Date().toISOString(),
      })
      .eq("id", person.id)
      .eq("owner_id", input.ownerId);
    if (personUpdateError) throw personUpdateError;

    const nextMetadata = existingIdentity.metadata && typeof existingIdentity.metadata === "object" && !Array.isArray(existingIdentity.metadata)
      ? { ...existingIdentity.metadata, ...metadata }
      : metadata;
    const { error: identityUpdateError } = await input.database
      .from("identities")
      .update({ username: username ?? existingIdentity.username, profile_url: profileUrl ?? existingIdentity.profile_url, metadata: nextMetadata })
      .eq("id", existingIdentity.id)
      .eq("owner_id", input.ownerId);
    if (identityUpdateError) throw identityUpdateError;

    return { personId: person.id, identityId: existingIdentity.id, createdPerson: false, createdIdentity: false };
  }

  const fallbackName = `${placeholderPrefix(input.source)}${externalIdentifier.replace(/^.*:/, "").slice(-6)}`;
  const { data: person, error: personError } = await input.database
    .from("people")
    .insert({
      owner_id: input.ownerId,
      display_name: displayName || fallbackName,
      relationship_type: "unknown",
      entity_type: "person",
      first_contact_at: now,
      last_contact_at: now,
    })
    .select("id")
    .single();
  if (personError || !person) throw personError ?? new Error("Could not create a person for the channel identity.");

  const { data: identity, error: identityError } = await input.database
    .from("identities")
    .insert({
      owner_id: input.ownerId,
      person_id: person.id,
      source: input.source,
      external_identifier: externalIdentifier,
      username,
      profile_url: profileUrl,
      metadata,
      verified_match: false,
      confidence: input.confidence ?? 0.8,
    })
    .select("id")
    .single();
  if (identityError || !identity) throw identityError ?? new Error("Could not create the channel identity.");

  return { personId: person.id, identityId: identity.id, createdPerson: true, createdIdentity: true };
}
