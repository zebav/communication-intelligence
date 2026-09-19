import { afterEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { followUpMail, sendOutlookFollowUp } from "./outlook-follow-up";
import { encryptCredential } from "@/lib/connectors/credential-crypto";
import type { Plan } from "./model";
vi.mock("./repository", () => ({ verifiedRecipient: async () => ({ recipient: "advisor@example.com" }) }));
const plan = { recipientPersonId: "advisor", recipient: "advisor@example.com", draft: "Har du hunnit granska avtalet?", evidence: { title: "Avtalet" } } as Plan;
it("addresses only the approved advisor, without original recipients or attachments", () => {
  expect(followUpMail(plan)).toEqual({ message: { subject: "Uppföljning: Avtalet", body: { contentType: "Text", content: plan.draft }, toRecipients: [{ emailAddress: { address: plan.recipient } }] }, saveToSentItems: true });
});
it("rejects missing identity, multiple recipients and empty drafts", () => {
  for (const edit of [{ recipientPersonId: null }, { recipient: "a@example.com;b@example.com" }, { draft: " " }]) expect(() => followUpMail({ ...plan, ...edit })).toThrow();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function fixture() {
  const key = Buffer.alloc(32, 4).toString("base64");
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", key);
  const account = { id: "account", account_identifier: "me@example.com", encrypted_credentials: encryptCredential({ accessToken: "test-only", expiresAt: "2099-01-01T00:00:00Z" }, key) };
  const db = { from: (table: string) => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === "connections" ? account : { id: "thread" }, error: null }), insert: async () => ({ error: null }), update: () => q, then: (resolve: (x: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) };
    return q;
  } } as unknown as SupabaseClient;
  return { db, p: { ...plan, evidence: { ...plan.evidence, personId: "advisor", account: "me@example.com", connectionId: "account", conversationId: "thread" } } };
}
it("sends once to the advisor and treats 202 as acceptance, not delivery", async () => {
  const { db, p } = fixture();
  const fetcher = vi.fn(async () => new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", fetcher);
  expect(await sendOutlookFollowUp(db, "owner", p, "https://example.com")).toMatchObject({ success: true, newEmail: true });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("never retries a timed-out send", async () => {
  const { db, p } = fixture();
  const fetcher = vi.fn(async () => { throw new Error("timeout"); });
  vi.stubGlobal("fetch", fetcher);
  await expect(sendOutlookFollowUp(db, "owner", p, "https://example.com")).rejects.toThrow("timeout");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("blocks changed identity before any provider call", async () => {
  const { db, p } = fixture();
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(sendOutlookFollowUp(db, "owner", { ...p, recipient: "original@example.com" }, "https://example.com")).rejects.toThrow("identitet");
  expect(fetcher).not.toHaveBeenCalled();
});
