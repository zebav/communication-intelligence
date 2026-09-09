import { describe, expect, it } from "vitest";
import { extractGmailBody, gmailAddress, gmailDisplayName, gmailHeader } from "./gmail-message";

const encoded = (value: string) => Buffer.from(value).toString("base64url");

describe("Gmail message normalization", () => {
  it("reads headers and a nested plain-text body", () => {
    const payload = { headers: [{ name: "Subject", value: "Status" }], parts: [{ mimeType: "text/plain", body: { data: encoded("Hello there") } }] };
    expect(gmailHeader(payload, "subject")).toBe("Status");
    expect(extractGmailBody(payload)).toBe("Hello there");
  });

  it("extracts the address and display name", () => {
    expect(gmailAddress('Jane Doe <jane@example.com>')).toBe("jane@example.com");
    expect(gmailDisplayName('"Jane Doe" <jane@example.com>')).toBe("Jane Doe");
  });
});
