import { describe, expect, it } from "vitest";
import { visibleInboxSources } from "./workspace";

describe("mobile inbox source navigation", () => {
  it("shows email plus sources that are connected or already have imported conversations", () => {
    const sources = visibleInboxSources(
      [{ provider: "slack", source: "slack" }],
      [{ source: "instagram" }],
      null,
    );

    expect(sources.map((source) => source.source)).toEqual(["email", "instagram", "slack"]);
  });

  it("keeps a deep-linked source visible until the user leaves it", () => {
    const sources = visibleInboxSources([], [], "whatsapp");

    expect(sources.map((source) => source.source)).toEqual(["email", "whatsapp"]);
  });

  it("does not advertise inactive sources with no account or imported conversation", () => {
    const sources = visibleInboxSources([], [], null);

    expect(sources.map((source) => source.source)).toEqual(["email"]);
  });
});
