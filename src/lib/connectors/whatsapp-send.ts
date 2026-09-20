import { whatsappMessagesUrl, whatsappSendBody } from "./whatsapp-api";
import type { WhatsAppProviderId } from "./whatsapp-provider";

export function assertWhatsAppReplyWindow(lastInbound: string | null, now = Date.now()) {
  const at = Date.parse(lastInbound ?? "");
  if (!Number.isFinite(at) || at > now || now - at >= 24 * 60 * 60 * 1000) throw new Error("WhatsApp-svar kräver ett inkommande meddelande inom de senaste 24 timmarna. Skicka annars i originalappen.");
}
export function internationalPhone(value: string) {
  const digits = value.replace(/[\s()+-]/g, "");
  if (!/^[1-9]\d{6,14}$/.test(digits)) throw new Error("Telefonnumret är inte entydigt verifierat.");
  return `+${digits}`;
}
/** One attempt only. A timeout is ambiguous and must never trigger provider fallback. */
export async function sendWhatsAppText(input: { provider: WhatsAppProviderId; from: string; to: string; phoneNumberId: string; body: string; credential: string }, transport: typeof fetch = fetch) {
  if (!input.credential || !input.body.trim()) throw new Error("Sändningsuppgifter saknas.");
  const to = internationalPhone(input.to);
  const ycloud = input.provider === "ycloud";
  const response = await transport(ycloud ? "https://api.ycloud.com/v2/whatsapp/messages/sendDirectly" : whatsappMessagesUrl(input.phoneNumberId), {
    method: "POST", headers: ycloud ? { "X-API-Key": input.credential, "content-type": "application/json" } : { authorization: `Bearer ${input.credential}`, "content-type": "application/json" },
    body: JSON.stringify(ycloud ? { from: internationalPhone(input.from), to, type: "text", text: { body: input.body } } : whatsappSendBody(to.slice(1), input.body)), signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("Leverantörens resultat behöver kontrolleras. Skicka inte igen automatiskt.");
  const result = await response.json();
  if (result.error) throw new Error("Leverantören rapporterade ett fel. Kontrollera utskicket.");
  const id = ycloud ? result.wamid ?? result.id : result.messages?.[0]?.id;
  if (typeof id !== "string" || !id) throw new Error("Leverantören saknar meddelandekvitto. Kontrollera utskicket innan nytt försök.");
  return { externalId: id, accepted: true as const };
}
