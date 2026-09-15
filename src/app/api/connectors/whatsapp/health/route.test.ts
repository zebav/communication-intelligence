import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/connectors/credential-crypto", () => ({ decryptCredential: () => ({ accessToken: "test-token" }) }));
import { GET } from "./route";
const callback = "https://example.com/api/connectors/whatsapp/webhook";
const request = () => new NextRequest("https://example.com/api/connectors/whatsapp/health");
function meta(apps: unknown[], appData = [{ object: "whatsapp_business_account", active: true, callback_url: callback, fields: [{ name: "messages" }] }]) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ data: appData })).mockResolvedValueOnce(Response.json({ data: apps })));
}
beforeEach(() => {
  vi.stubEnv("WHATSAPP_APP_ID", "123"); vi.stubEnv("WHATSAPP_APP_SECRET", "secret"); vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "key"); vi.stubEnv("APP_URL", "https://example.com");
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) chain[method] = () => chain;
  chain.order = async () => ({ data: [{ id: "connection", encrypted_credentials: "encrypted", token_metadata: { business_account_id: "456", webhook_subscription: "subscribed", webhook_callback_url: callback } }], error: null });
  mocks.client.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }), mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal2" } }) } }, from: () => chain });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("live WhatsApp health evidence", () => {
  it("selects the configured app, not the first subscription", async () => { meta([{ whatsapp_business_api_data: { id: "999" }, override_callback_uri: "https://wrong.example" }, { whatsapp_business_api_data: { id: "123" }, override_callback_uri: callback }]); const data = await (await GET(request())).json(); expect(data.accounts[0]).toMatchObject({ live_delivery: "subscribed", callback_matches: true, messages_field: "subscribed" }); });
  it("does not use stale stored success when Meta fails", async () => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({}, { status: 403 }))); const data = await (await GET(request())).json(); expect(data.accounts[0]).toMatchObject({ live_delivery: "unknown", callback_url: null, callback_matches: null, messages_field: "unknown" }); });
  it("reports another app's subscription as not subscribed", async () => { meta([{ whatsapp_business_api_data: { id: "999" } }]); const data = await (await GET(request())).json(); expect(data.accounts[0].live_delivery).toBe("not_subscribed"); });
  it("reports a missing messages field even when WABA is subscribed", async () => { meta([{ whatsapp_business_api_data: { id: "123" } }], [{ object: "whatsapp_business_account", active: true, callback_url: callback, fields: [] }]); const data = await (await GET(request())).json(); expect(data.accounts[0]).toMatchObject({ live_delivery: "subscribed", messages_field: "not_subscribed" }); });
});
