import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/connectors/credential-crypto", () => ({ decryptCredential: () => ({ accessToken: "test-token" }) }));
import { POST } from "./route";
beforeEach(() => {
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "key"); vi.stubEnv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", "verify-token"); vi.stubEnv("APP_URL", "https://production.example");
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) chain[method] = () => chain;
  chain.maybeSingle = async () => ({ data: { id: "connection", encrypted_credentials: "encrypted", token_metadata: { business_account_id: "456" } }, error: null });
  mocks.client.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }), mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal2" } }) } }, from: () => chain });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it.each([302, 403, 200])("does not change Meta routing when public verification fails (%s)", async (status) => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("Not the challenge", { status })); vi.stubGlobal("fetch", fetchMock);
  const response = await POST(new NextRequest("https://preview.example/api/connectors/whatsapp/subscribe", { method: "POST", headers: { origin: "https://preview.example", "content-type": "application/json" }, body: JSON.stringify({ connectionId: "3c57c224-fb05-463c-a4a7-23fd20b66fb4" }) }));
  expect(response.status).toBe(409); expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0].origin).toBe("https://production.example");
  expect(fetchMock.mock.calls[0][1].redirect).toBe("manual");
});
