import { afterEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { gmailReplyContent, sendApprovedGmailReply } from "./gmail-reply";
import { encryptCredential } from "@/lib/connectors/credential-crypto";
import type { Plan } from "./model";
const headers = [{ name: "From", value: "Person <person@example.com>" }, { name: "Message-ID", value: "<original@example.com>" }, { name: "Subject", value: "Möte 👋 i morgon" }];
it("encodes only approved recipient and body with thread headers", () => {
  const raw = Buffer.from(gmailReplyContent(headers, "me@example.com", "person@example.com", "Hej åäö!"), "base64url").toString();
  expect(raw).toContain("To: person@example.com\r\n");
  expect(raw).toContain("In-Reply-To: <original@example.com>");
  expect(raw).not.toContain("Bcc:");
  expect(Buffer.from(raw.split("\r\n\r\n")[1], "base64").toString()).toBe("Hej åäö!");
});
it("blocks changed Reply-To instead of silently redirecting a reply", () => expect(() => gmailReplyContent([...headers, { name: "Reply-To", value: "other@example.com" }], "me@example.com", "person@example.com", "Hej")).toThrow());
it("rejects injected recipients and duplicate headers", () => {
  expect(() => gmailReplyContent(headers, "me@example.com\r\nBcc: bad@example.com", "person@example.com", "Hej")).toThrow();
  expect(() => gmailReplyContent([...headers, headers[0]], "me@example.com", "person@example.com", "Hej")).toThrow();
});
it("does not guess a reply thread without a message id", () => expect(() => gmailReplyContent(headers.filter(h => h.name !== "Message-ID"), "me@example.com", "person@example.com", "Hej")).toThrow());
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function sendingFixture() {
  const key = Buffer.alloc(32, 7).toString("base64");
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", key);
  const connection = { id: "account", account_identifier: "me@example.com", encrypted_credentials: encryptCredential({ accessToken: "test-token", expiresAt: "2099-01-01T00:00:00Z" }, key) };
  const from = vi.fn((table: string) => {
    const query = { select: vi.fn(() => query), eq: vi.fn(() => query), maybeSingle: vi.fn(async () => ({ data: table === "connections" ? connection : { external_message_id: "gmail:account:abc123" }, error: null })), upsert: vi.fn(async () => ({ error: null })), update: vi.fn(() => query), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) };
    return query;
  });
  const plan = { evidence: { account: "me@example.com", connectionId: "account", conversationId: "thread" }, recipient: "person@example.com", draft: "Granskat svar" } as Plan;
  return { db: { from } as unknown as SupabaseClient, plan };
}
it("reads original then sends exactly once and persists the receipt", async () => {
  const { db, plan } = sendingFixture();
  const transport = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ threadId: "gmail-thread", payload: { headers } }))).mockResolvedValueOnce(new Response(JSON.stringify({ id: "sent123" })));
  vi.stubGlobal("fetch", transport);
  expect(await sendApprovedGmailReply(db, "owner", plan, "message", "https://example.com")).toMatchObject({ success: true, externalId: "sent123" });
  expect(transport).toHaveBeenCalledTimes(2);
  expect(JSON.parse(transport.mock.calls[1][1].body).threadId).toBe("gmail-thread");
});
it("does not send if the live recipient differs", async () => {
  const { db, plan } = sendingFixture();
  const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify({ threadId: "gmail-thread", payload: { headers: [...headers, { name: "Reply-To", value: "other@example.com" }] } })));
  vi.stubGlobal("fetch", transport);
  await expect(sendApprovedGmailReply(db, "owner", plan, "message", "https://example.com")).rejects.toThrow("svarsmottagare");
  expect(transport).toHaveBeenCalledTimes(1);
});
it("never retries an ambiguous Gmail send", async () => {
  const { db, plan } = sendingFixture();
  const transport = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ threadId: "gmail-thread", payload: { headers } }))).mockRejectedValueOnce(new Error("timeout"));
  vi.stubGlobal("fetch", transport);
  await expect(sendApprovedGmailReply(db, "owner", plan, "message", "https://example.com")).rejects.toThrow("timeout");
  expect(transport).toHaveBeenCalledTimes(2);
});
