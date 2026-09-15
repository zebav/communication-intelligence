/** Only route to an unambiguous international WhatsApp identity. */
export function whatsappComposeUrl(draft: string, recipient?: string) {
  if (!draft.trim()) return null;
  const phone = recipient?.replace(/^whatsapp:/, "").replace(/[\s()+-]/g, "") ?? "";
  const validPhone = /^[1-9]\d{6,14}$/.test(phone);
  return `https://wa.me/${validPhone ? phone : ""}?text=${encodeURIComponent(draft)}`;
}
