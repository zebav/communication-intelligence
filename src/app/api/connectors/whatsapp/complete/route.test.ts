import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ client: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/connectors/credential-crypto", () => ({ encryptCredential: () => "encrypted" }));
import { POST } from "./route";
beforeEach(() => {
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "key"); vi.stubEnv("WHATSAPP_APP_ID", "1"); vi.stubEnv("WHATSAPP_APP_SECRET", "secret");
  mocks.from.mockReset();
  mocks.client.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }), mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal2" } }) } }, from: mocks.from });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const request = (phoneNumberId?: string) => new NextRequest("https://preview.example/api/connectors/whatsapp/complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "test-code", businessAccountId: "123", phoneNumberId }) });
it.each([
  { data: [] },
  { data: [{ id: "456", is_on_biz_app: true, platform_type: "NOT_APPLICABLE" }] },
  { data: [{ id: "456", is_on_biz_app: true, platform_type: "CLOUD_API" }, { id: "789", is_on_biz_app: true, platform_type: "CLOUD_API" }] },
  { data: [{ id: "456", is_on_biz_app: true, platform_type: "CLOUD_API" }], paging: { next: "more" } },
])("does not subscribe or save an unresolved Business app number", async (numbers) => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "token" })).mockResolvedValueOnce(Response.json(numbers)); vi.stubGlobal("fetch", fetchMock);
  expect((await POST(request())).status).toBe(409);
  expect(fetchMock).toHaveBeenCalledTimes(2); expect(mocks.from).not.toHaveBeenCalled();
});
it("resolves a WABA-only completion to the verified Cloud API number", async () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "contains"]) chain[method] = () => chain;
  chain.maybeSingle = async () => ({ data: null }); chain.insert = async () => ({ error: null }); mocks.from.mockReturnValue(chain);
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "token" })).mockResolvedValueOnce(Response.json({ data: [{ id: "456", is_on_biz_app: true, platform_type: "CLOUD_API" }] })).mockResolvedValueOnce(Response.json({ display_phone_number: "+46123" })).mockResolvedValueOnce(Response.json({ success: true })); vi.stubGlobal("fetch", fetchMock);
  expect((await POST(request())).status).toBe(200);
  expect(String(fetchMock.mock.calls[2][0])).toContain("/456?fields=");
});
it("rejects a supplied number belonging to a different WABA", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "token" })).mockResolvedValueOnce(Response.json({ data: [{ id: "789", is_on_biz_app: true, platform_type: "CLOUD_API" }] })); vi.stubGlobal("fetch", fetchMock);
  expect((await POST(request("456"))).status).toBe(409); expect(mocks.from).not.toHaveBeenCalled();
});
