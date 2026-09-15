const GRAPH_HOST = "https://graph.facebook.com";

export type WhatsAppEmbeddedSignupSession = { businessAccountId: string; phoneNumberId?: string };

export function parseWhatsAppEmbeddedSignupEvent(value: unknown): WhatsAppEmbeddedSignupSession | null {
  let payload = value;
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload) as unknown; } catch { return null; }
  }
  if (!payload || typeof payload !== "object") return null;
  const event = payload as { type?: unknown; event?: unknown; data?: { waba_id?: unknown; phone_number_id?: unknown } };
  const coexistence = event.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING";
  if (event.type !== "WA_EMBEDDED_SIGNUP" || (!coexistence && event.event !== "FINISH")) return null;
  const businessAccountId = typeof event.data?.waba_id === "string" ? event.data.waba_id.trim() : "";
  const phoneNumberId = typeof event.data?.phone_number_id === "string" ? event.data.phone_number_id.trim() : "";
  if (!/^\d+$/.test(businessAccountId)) return null;
  if (phoneNumberId && !/^\d+$/.test(phoneNumberId)) return null;
  if (!phoneNumberId && !coexistence) return null;
  return { businessAccountId, ...(phoneNumberId ? { phoneNumberId } : {}) };
}

export function whatsappTokenExchangeUrl(input: { appId: string; appSecret: string; code: string; version: string }) {
  const url = new URL(`/${input.version}/oauth/access_token`, GRAPH_HOST);
  url.search = new URLSearchParams({ client_id: input.appId, client_secret: input.appSecret, code: input.code }).toString();
  return url;
}
