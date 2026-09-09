import { describe, expect, it } from "vitest";
import { parseImportedConversation } from "./manual-import";

describe("manual conversation import", () => {
  it("parses dated chat exports", () => {
    const result = parseImportedConversation("[2026-09-01 10:00] Alex: Hello\n[2026-09-01 10:02] Me: Hi");
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ sender: "Alex", body: "Hello" });
  });
  it("parses common JSON exports", () => {
    expect(parseImportedConversation('[{"from":"Alex","text":"Hello"}]')[0]).toMatchObject({ sender: "Alex", body: "Hello" });
  });
  it("keeps unstructured text as one reviewable message", () => {
    expect(parseImportedConversation("A message without labels")).toHaveLength(1);
  });
});
