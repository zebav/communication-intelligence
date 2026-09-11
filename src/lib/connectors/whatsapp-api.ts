const validId = (value: string) => /^\d+$/.test(value);

export function whatsappMessagesUrl(phoneNumberId: string, version = process.env.META_GRAPH_API_VERSION || "v23.0") {
  if (!validId(phoneNumberId)) throw new Error("invalid_whatsapp_phone_number_id");
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("invalid_meta_graph_version");
  return `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
}

export function whatsappPhoneUrl(phoneNumberId: string, version = process.env.META_GRAPH_API_VERSION || "v23.0") {
  if (!validId(phoneNumberId)) throw new Error("invalid_whatsapp_phone_number_id");
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("invalid_meta_graph_version");
  return `https://graph.facebook.com/${version}/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`;
}

export function whatsappSendBody(recipient: string, text: string) {
  if (!validId(recipient)) throw new Error("invalid_whatsapp_recipient");
  const body = text.trim();
  if (!body || body.length > 4096) throw new Error("invalid_whatsapp_message");
  return { messaging_product: "whatsapp", recipient_type: "individual", to: recipient, type: "text", text: { preview_url: false, body } };
}
