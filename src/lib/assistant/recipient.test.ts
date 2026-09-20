import { describe, expect, it } from "vitest";
import { matchesReplyRecipient } from "./recipient";
const address = (address: string) => ({ emailAddress: { address } });
describe("reviewed Graph recipient", () => {
  it("matches the sender only when no Reply-To is supplied", () => {
    expect(matchesReplyRecipient({ from: address("Anna@example.invalid") }, "anna@example.invalid")).toBe(true);
  });
  it("rejects a Reply-To different from the reviewed sender", () => {
    expect(matchesReplyRecipient({ from: address("anna@example.invalid"), replyTo: [address("other@example.invalid")] }, "anna@example.invalid")).toBe(false);
  });
  it("requires the exact single Reply-To recipient", () => {
    expect(matchesReplyRecipient({ replyTo: [address("other@example.invalid")] }, "other@example.invalid")).toBe(true);
    expect(matchesReplyRecipient({ replyTo: [address("anna@example.invalid"), address("other@example.invalid")] }, "anna@example.invalid")).toBe(false);
  });
  it("fails closed for missing addresses", () => expect(matchesReplyRecipient({}, "anna@example.invalid")).toBe(false));
});
