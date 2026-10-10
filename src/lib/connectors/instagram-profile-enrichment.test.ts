import { describe, expect, it } from "vitest";
import { instagramProfileLookupMetadata, shouldEnrichInstagramProfile } from "./instagram-profile-enrichment";

describe("Instagram profile enrichment", () => {
  const now = Date.parse("2026-10-10T10:00:00Z");

  it("enriches an unnamed historical identity only when no retry backoff is active", () => {
    expect(shouldEnrichInstagramProfile({ username: null, metadata: {} }, now)).toBe(true);
    expect(shouldEnrichInstagramProfile({ username: null, metadata: instagramProfileLookupMetadata(now, false) }, now)).toBe(false);
  });

  it("does not fetch a provider profile once a username is already stored", () => {
    expect(shouldEnrichInstagramProfile({ username: "margo" }, now)).toBe(false);
  });

  it("records a bounded retry after an unavailable provider profile", () => {
    const retryAt = instagramProfileLookupMetadata(now, false).profile_lookup_not_before;
    expect(typeof retryAt).toBe("string");
    expect(Date.parse(retryAt as string)).toBeGreaterThan(now);
  });
});
