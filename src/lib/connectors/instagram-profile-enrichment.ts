type InstagramIdentity = { username?: string | null; metadata?: unknown } | null | undefined;

const PLACEHOLDER_RETRY_MS = 6 * 60 * 60 * 1000;

function metadataRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * Historical Instagram repair deliberately imports messages before fetching a
 * remote profile. This keeps message delivery fast. A later bounded pass may
 * enrich only unnamed identities, never use a name to merge people, and backs
 * off after an unavailable profile lookup.
 */
export function shouldEnrichInstagramProfile(identity: InstagramIdentity, now = Date.now()) {
  if (identity?.username?.trim()) return false;
  const retryAfter = metadataRecord(identity?.metadata).profile_lookup_not_before;
  const retryAt = typeof retryAfter === "string" ? Date.parse(retryAfter) : NaN;
  return !Number.isFinite(retryAt) || retryAt <= now;
}

export function instagramProfileLookupMetadata(now = Date.now(), resolved = false) {
  return resolved
    ? { profile_enriched_at: new Date(now).toISOString(), profile_lookup_not_before: null }
    : { profile_lookup_not_before: new Date(now + PLACEHOLDER_RETRY_MS).toISOString() };
}
