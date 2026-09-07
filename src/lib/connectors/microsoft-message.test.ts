import { describe, expect, it } from "vitest";
import { extractMicrosoftMessageText } from "./microsoft-message";

describe("Microsoft message content", () => {
  it("prefers the unique message body so quoted thread history is not duplicated", () => {
    expect(extractMicrosoftMessageText({
      uniqueBody: { contentType: "text", content: "New answer" },
      body: { contentType: "text", content: "New answer\nOld thread" },
      bodyPreview: "New ans",
    })).toMatchObject({ text: "New answer", source: "uniqueBody", fullContent: true });
  });

  it("safely converts an unexpected HTML response to readable text", () => {
    expect(extractMicrosoftMessageText({ body: { contentType: "html", content: "<p>Hello &amp; welcome</p><script>bad()</script><p>Next</p>" } }).text)
      .toBe("Hello & welcome\nNext");
  });

  it("marks preview-only messages as incomplete", () => {
    expect(extractMicrosoftMessageText({ bodyPreview: "Preview" })).toEqual({ text: "Preview", source: "bodyPreview", fullContent: false, truncated: false });
  });
});
