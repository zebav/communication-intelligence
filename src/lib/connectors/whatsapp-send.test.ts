import { expect, it, vi } from "vitest";
import { assertWhatsAppReplyWindow, internationalPhone, sendWhatsAppText } from "./whatsapp-send";
it("rejects unknown, future and expired reply windows", () => {
  for (const at of [null, "bad", "2026-09-18T00:00:00Z", "2026-09-16T00:00:00Z"]) expect(() => assertWhatsAppReplyWindow(at, Date.parse("2026-09-17T00:00:00Z"))).toThrow();
  expect(() => assertWhatsAppReplyWindow("2026-09-16T23:00:00Z", Date.parse("2026-09-17T00:00:00Z"))).not.toThrow();
});
it("rejects ambiguous recipients", () => expect(() => internationalPhone("someone@example.com")).toThrow());
const input = { provider: "ycloud" as const, from: "+46700000001", to: "46700000002", phoneNumberId: "123", body: "Granskat svar", credential: "test-only" };
it("binds YCloud sender, recipient and exact reviewed text", async () => {
  const transport = vi.fn(async () => new Response(JSON.stringify({ wamid: "accepted-id" })));
  expect(await sendWhatsAppText(input, transport)).toEqual({ externalId: "accepted-id", accepted: true });
  expect(transport).toHaveBeenCalledTimes(1);
  const [url, options] = transport.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain("api.ycloud.com");
  expect(JSON.parse(String(options.body))).toEqual({ from: input.from, to: "+46700000002", type: "text", text: { body: input.body } });
});
it("never retries or changes provider after a timeout", async () => {
  const transport = vi.fn(async () => { throw new Error("timeout"); });
  await expect(sendWhatsAppText(input, transport)).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(1);
});
it("does not invent a receipt for malformed success", async () => {
  await expect(sendWhatsAppText(input, vi.fn(async () => new Response("{}")))).rejects.toThrow("meddelandekvitto");
});
