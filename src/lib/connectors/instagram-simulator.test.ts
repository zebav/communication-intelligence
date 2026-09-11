import { describe, expect, it } from "vitest";
import { parseInstagramWebhook, validInstagramWebhookSignature } from "./instagram-webhook";
import { signSimulatedInstagramWebhook, simulatedInstagramWebhook, uniqueSimulatedDeliveries } from "./instagram-simulator";

describe("Instagram release simulator", () => {
  it("simulates a signed incoming delivery from end to end", () => {
    const body = simulatedInstagramWebhook({ accountId: "1001", participantId: "2002", messageId: "mid.1", text: "Vill du ta en kaffe på fredag?", timestamp: 1_700_000_000_000 });
    expect(validInstagramWebhookSignature(body, signSimulatedInstagramWebhook(body, "app-secret"), "app-secret")).toBe(true);
    expect(parseInstagramWebhook(body)[0]).toMatchObject({ accountId: "1001", participantId: "2002", message: { externalId: "mid.1", direction: "in", body: "Vill du ta en kaffe på fredag?" } });
  });

  it("simulates an outgoing echo", () => {
    const body = simulatedInstagramWebhook({ accountId: "1001", participantId: "2002", messageId: "mid.2", text: "Gärna!", direction: "out" });
    expect(parseInstagramWebhook(body)[0]?.message.direction).toBe("out");
  });

  it("collapses Meta retries by provider message id", () => {
    const first = simulatedInstagramWebhook({ accountId: "1001", participantId: "2002", messageId: "same", text: "Hej" });
    const retry = simulatedInstagramWebhook({ accountId: "1001", participantId: "2002", messageId: "same", text: "Hej" });
    expect(uniqueSimulatedDeliveries([first, retry])).toEqual([first]);
  });

  it("simulates media without exposing its temporary URL", () => {
    const body = simulatedInstagramWebhook({ accountId: "1001", participantId: "2002", messageId: "mid.image", attachmentType: "image" });
    const parsed = parseInstagramWebhook(body)[0];
    expect(parsed.message.providerMetadata).toMatchObject({ attachment_types: ["image"], media_analysis_status: "pending" });
    expect(JSON.stringify(parsed)).not.toContain("temporary.invalid");
  });
});
