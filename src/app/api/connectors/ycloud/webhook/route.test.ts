import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), ingest: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/connectors/whatsapp-ingestion", () => ({ ingestWhatsAppEvents: mocks.ingest }));
import { POST } from "./route";
const body = JSON.stringify({ id: "event", type: "whatsapp.inbound_message.received", whatsappInboundMessage: { wamid: "wamid.x", wabaId: "123", from: "+46701234567", to: "+46707654321", sendTime: "2026-09-15T10:00:00Z", type: "text", text: { body: "Hello" } } });
function request(valid = true) { const t = Math.floor(Date.now() / 1000); return new NextRequest("https://example.com/api/connectors/ycloud/webhook", { method: "POST", body, headers: { "ycloud-signature": valid ? `t=${t},s=${createHmac("sha256", "secret").update(`${t}.${body}`).digest("hex")}` : "invalid" } }); }
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("YCLOUD_WEBHOOK_SECRET", "secret"); });
afterEach(() => vi.unstubAllEnvs());
it("rejects unauthorized events before database lookup", async () => { expect((await POST(request(false))).status).toBe(401); expect(mocks.admin).not.toHaveBeenCalled(); });
it.each([{ data: [] }, { data: [{ account_identifier: "+46707654321", token_metadata: { business_account_id: "wrong", phone_number_id: "456" } }] }])("rejects unknown WABA routing", async ({ data }) => {
 const chain = { select: () => chain, eq: () => chain, then: (resolve: (v: unknown) => void) => Promise.resolve({ data, error: null }).then(resolve) }; mocks.admin.mockReturnValue({ from: () => chain });
 expect((await POST(request())).status).toBe(503); expect(mocks.ingest).not.toHaveBeenCalled();
});
it("only ingests a unique WABA plus business-number match", async () => {
 const data = [{ account_identifier: "+46 70 765 43 21", token_metadata: { business_account_id: "123", phone_number_id: "456" } }];
 const chain = { select: () => chain, eq: () => chain, then: (resolve: (v: unknown) => void) => Promise.resolve({ data, error: null }).then(resolve) }; mocks.admin.mockReturnValue({ from: () => chain }); mocks.ingest.mockResolvedValue(Response.json({ received: true }));
 expect((await POST(request())).status).toBe(200); expect(mocks.ingest.mock.calls[0][0].messages[0].phoneNumberId).toBe("456");
});
it("authenticates but ignores YCloud deliveries when Meta Direct is active", async () => {
 vi.stubEnv("WHATSAPP_ACTIVE_PROVIDER", "meta-direct");
 const response = await POST(request());
 expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({ ignored: true, provider: "ycloud", activeProvider: "meta-direct" });
 expect(mocks.admin).not.toHaveBeenCalled();
});
