import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), resolve: vi.fn(), after: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/connectors/person-resolution", () => ({ resolveOrCreateChannelPerson: mocks.resolve }));
vi.mock("@/lib/connectors/whatsapp-intelligence", () => ({ analyzeIncomingWhatsAppMessage: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({ ...await importOriginal<typeof import("next/server")>(), after: mocks.after }));
import { POST } from "./route";
const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "200", changes: [{ field: "messages", value: { metadata: { phone_number_id: "100" }, messages: [{ id: "wamid.test", from: "46700000000", type: "text", text: { body: "test" }, timestamp: "1700000000" }] } }] }] });
function request(signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`) {
  return new NextRequest("https://example.com/api/connectors/whatsapp/webhook", { method: "POST", body, headers: { "x-hub-signature-256": signature } });
}
function database({ connections = [{ id: "connection", owner_id: "owner", token_metadata: { phone_number_id: "100" } }], saveError = null as null | { code: string }, duplicate = false } = {}) {
  return { from: vi.fn((table: string) => {
    const result = table === "connections" ? { data: connections, error: null } : { data: null, error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "insert", "update", "upsert"]) chain[method] = vi.fn(() => chain);
    chain.then = (resolve: (value: unknown) => void) => Promise.resolve(result).then(resolve);
    chain.single = vi.fn(async () => ({ data: { id: "conversation" }, error: null }));
    chain.maybeSingle = vi.fn(async () => table === "messages" ? { data: duplicate || saveError ? null : { id: "message" }, error: saveError } : result);
    return chain;
  }) };
}
describe("WhatsApp delivery acknowledgment", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("WHATSAPP_APP_SECRET", "secret"); mocks.resolve.mockResolvedValue({ personId: "person", identityId: "identity" }); });
  it("rejects invalid signatures before accessing data", async () => { expect((await POST(request("sha256=invalid"))).status).toBe(401); expect(mocks.admin).not.toHaveBeenCalled(); });
  it("asks Meta to retry database errors", async () => { mocks.admin.mockReturnValue(database({ saveError: { code: "08006" } })); const response = await POST(request()); expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ failed: 1, imported: 0 }); });
  it("does not acknowledge a message for an unmatched phone", async () => { mocks.admin.mockReturnValue(database({ connections: [] })); expect((await POST(request())).status).toBe(503); expect(mocks.resolve).not.toHaveBeenCalled(); });
  it("acknowledges saved messages and schedules analysis", async () => { mocks.admin.mockReturnValue(database()); const response = await POST(request()); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ imported: 1, failed: 0 }); expect(mocks.after).toHaveBeenCalledOnce(); });
  it("acknowledges retries without analyzing duplicates again", async () => { mocks.admin.mockReturnValue(database({ duplicate: true })); const response = await POST(request()); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ imported: 0 }); expect(mocks.after).not.toHaveBeenCalled(); });
});
