export type MicrosoftItemBody = { contentType?: string; content?: string };

const MAX_STORED_BODY_LENGTH = 20_000;

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

function htmlToText(value: string) {
  return decodeHtmlEntities(value
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<a\b[^>]*href=["'](https:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, ""));
}

function normalize(value: string) {
  return value.replace(/\0/g, "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function extractMicrosoftMessageText(message: { uniqueBody?: MicrosoftItemBody; body?: MicrosoftItemBody; bodyPreview?: string }) {
  const selected = message.uniqueBody?.content
    ? { value: message.uniqueBody.content, type: message.uniqueBody.contentType, source: "uniqueBody" as const }
    : message.body?.content
      ? { value: message.body.content, type: message.body.contentType, source: "body" as const }
      : { value: message.bodyPreview ?? "", type: "text", source: "bodyPreview" as const };
  const normalized = normalize(selected.type?.toLowerCase() === "html" ? htmlToText(selected.value) : selected.value);
  return {
    text: normalized.slice(0, MAX_STORED_BODY_LENGTH),
    source: selected.source,
    fullContent: selected.source !== "bodyPreview",
    truncated: normalized.length > MAX_STORED_BODY_LENGTH,
  };
}
