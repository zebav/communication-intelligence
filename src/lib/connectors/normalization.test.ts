import { describe, expect, it } from "vitest";
import { microsoftGraphConnector } from "./microsoft-graph";
import { connectorById } from "./catalog";
import { normalizeCommunicationMessage } from "./normalization";

describe("provider-neutral normalization", () => {
  it("normalizes Outlook into the common message contract", () => { const item = normalizeCommunicationMessage(microsoftGraphConnector, { externalId: "m1", externalConversationId: "c1", direction: "in", senderIdentifier: " PERSON@EXAMPLE.COM ", body: " Hello ", sentAt: "2026-09-09T08:00:00Z" }); expect(item).toMatchObject({ source: "email", channelKind: "email", senderIdentifier: "person@example.com", body: "Hello" }); });
  it("uses the same contract for a planned direct-message channel", () => { const instagram = connectorById("instagram-professional"); expect(instagram && normalizeCommunicationMessage(instagram, { externalId: "ig1", direction: "in", body: "Hi" }).channelKind).toBe("direct-message"); });
  it("rejects messages without a provider identifier", () => { expect(() => normalizeCommunicationMessage(microsoftGraphConnector, { externalId: " ", direction: "in" })).toThrow("external_message_id_required"); });
});
