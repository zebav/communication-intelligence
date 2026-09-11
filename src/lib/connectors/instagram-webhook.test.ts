import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseInstagramWebhook, validInstagramWebhookSignature } from "./instagram-webhook";

describe("Instagram webhook", () => {
  it("verifies Meta signatures", () => {
    const body = '{"object":"instagram"}';
    const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(validInstagramWebhookSignature(body, signature, "secret")).toBe(true);
    expect(validInstagramWebhookSignature(body, signature, "wrong")).toBe(false);
  });

  it("normalizes incoming and echoed messages", () => {
    const messages = parseInstagramWebhook(JSON.stringify({ object: "instagram", entry: [{ id: "owner-1", messaging: [
      { sender: { id: "person-1" }, recipient: { id: "owner-1" }, timestamp: 1_700_000_000_000, message: { mid: "in-1", text: "Hej!" } },
      { sender: { id: "owner-1" }, recipient: { id: "person-1" }, timestamp: 1_700_000_001_000, message: { mid: "out-1", text: "Hej tillbaka", is_echo: true } },
    ] }] }));
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ accountId: "owner-1", participantId: "person-1", message: { source: "instagram", direction: "in", externalId: "in-1" } });
    expect(messages[1]?.message.direction).toBe("out");
  });

  it("ignores malformed and non-message events", () => {
    expect(parseInstagramWebhook("not json")).toEqual([]);
    expect(parseInstagramWebhook(JSON.stringify({ object: "page", entry: [] }))).toEqual([]);
    expect(parseInstagramWebhook(JSON.stringify({ object: "instagram", entry: [{ id: "owner", messaging: [{ sender: { id: "person" }, recipient: { id: "owner" }, message: {} }] }] }))).toEqual([]);
  });

  it("records attachment types without persisting temporary media URLs", () => {
    const [item] = parseInstagramWebhook(JSON.stringify({ object: "instagram", entry: [{ id: "100", messaging: [{ sender: { id: "200" }, recipient: { id: "100" }, message: { mid: "media-1", attachments: [{ type: "image", payload: { url: "https://temporary.example/secret" } }] } }] }] }));
    expect(item.message.providerMetadata).toMatchObject({ attachment_types: ["image"], media_analysis_status: "pending" });
    expect(JSON.stringify(item)).not.toContain("temporary.example");
  });
});
