import { expect, it } from "vitest";
import { whatsappComposeUrl } from "./whatsapp-compose";
it("preserves edited text and encodes special characters", () => {
 const text = "Hej Åsa!\nA & B? 😊";
 const url = new URL(whatsappComposeUrl(text, "+46 70-123 45 67")!);
 expect(url.pathname).toBe("/46701234567"); expect(url.searchParams.get("text")).toBe(text);
});
it("uses contact selection for unknown or invalid identities", () => {
 for (const recipient of [undefined, "0701234567", "US.1234567", "person@example.com"]) expect(new URL(whatsappComposeUrl("Hej", recipient)!).pathname).toBe("/");
 expect(whatsappComposeUrl("  ", "46701234567")).toBeNull();
});

it("recognizes the stored WhatsApp identity prefix", () => { expect(new URL(whatsappComposeUrl("Hej", "whatsapp:46701234567")!).pathname).toBe("/46701234567"); });
