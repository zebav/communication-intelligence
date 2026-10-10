import { describe, expect, it } from "vitest";
import { isImportedPlaceholderName, presentPersonName } from "./person-presentation";

describe("person presentation", () => {
  it("does not present a provider placeholder with a private identifier as a name", () => {
    expect(isImportedPlaceholderName("Instagram contact 639911")).toBe(true);
    expect(presentPersonName({ displayName: "Instagram contact 639911", source: "instagram" })).toBe("Instagram-kontakt");
  });

  it("uses an imported Instagram username when one is available", () => {
    expect(presentPersonName({ displayName: "Instagram contact 639911", source: "instagram", identities: [{ source: "instagram", username: "anna" }] })).toBe("@anna");
  });

  it("preserves an owner or provider supplied person name", () => {
    expect(presentPersonName({ displayName: "Anna Andersson", source: "instagram" })).toBe("Anna Andersson");
  });
});
