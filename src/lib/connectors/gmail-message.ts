export type GmailPayload = { mimeType?: string; headers?: Array<{ name?: string; value?: string }>; body?: { data?: string }; parts?: GmailPayload[] };

function decode(data?: string) {
  if (!data) return "";
  try { return Buffer.from(data, "base64url").toString("utf8"); } catch { return ""; }
}

function stripHtml(value: string) {
  return value.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<a\b[^>]*href=["'](https:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)").replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").trim();
}

function body(payload?: GmailPayload): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) return decode(payload.body.data).trim();
  for (const part of payload.parts ?? []) { const text = body(part); if (text) return text; }
  return payload.mimeType === "text/html" ? stripHtml(decode(payload.body?.data)) : decode(payload.body?.data).trim();
}

export function gmailHeader(payload: GmailPayload | undefined, name: string) {
  return payload?.headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value?.trim();
}

export function gmailAddress(value?: string) {
  const bracketed = value?.match(/<([^>]+@[^>]+)>/)?.[1];
  return (bracketed ?? value?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "").toLowerCase();
}

export function gmailDisplayName(value?: string) {
  const name = value?.replace(/<[^>]+>/g, "").trim().replace(/^"|"$/g, "").trim();
  return name || gmailAddress(value);
}

export function extractGmailBody(payload?: GmailPayload, snippet?: string) {
  return body(payload) || snippet?.trim() || "";
}
