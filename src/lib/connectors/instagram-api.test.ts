import { describe, expect, it } from "vitest";
import { instagramMessagesUrl, instagramSendBody, instagramUserProfileUrl } from "./instagram-api";

describe("Instagram messaging API", () => {
  it("builds a versioned Graph endpoint", () => expect(instagramMessagesUrl("123", "v23.0")).toBe("https://graph.instagram.com/v23.0/123/messages"));
  it("builds a scoped user profile endpoint", () => expect(instagramUserProfileUrl("456", "v23.0")).toBe("https://graph.instagram.com/v23.0/456?fields=name%2Cusername"));
  it("builds a recipient-scoped text message", () => expect(instagramSendBody("456", " Hej! ")).toEqual({ recipient: { id: "456" }, message: { text: "Hej!" } }));
  it("rejects unsafe identifiers and empty messages", () => {
    expect(() => instagramMessagesUrl("../me", "v23.0")).toThrow();
    expect(() => instagramSendBody("456", " ")).toThrow();
  });
});
