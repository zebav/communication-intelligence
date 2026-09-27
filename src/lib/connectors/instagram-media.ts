import type { MediaAttachment } from "@/lib/media/email-worker";

type RawAttachment = { type?: unknown; payload?: { url?: unknown } };
type RawMessaging = { message?: { mid?: unknown; attachments?: RawAttachment[] } };
type RawPayload = { object?: unknown; entry?: Array<{ messaging?: RawMessaging[] }> };

const acceptedHosts = ["lookaside.fbsbx.com", ".fbcdn.net", ".cdninstagram.com"];

export function ephemeralInstagramMediaUrls(rawBody: string) {
  let payload: RawPayload;
  try { payload = JSON.parse(rawBody) as RawPayload; } catch { return new Map<string, string[]>(); }
  if (payload.object !== "instagram") return new Map<string, string[]>();
  const result = new Map<string, string[]>();
  for (const entry of payload.entry ?? []) for (const event of entry.messaging ?? []) {
    const messageId = typeof event.message?.mid === "string" ? event.message.mid.trim() : "";
    if (!messageId) continue;
    const urls = (event.message?.attachments ?? []).flatMap((attachment) => typeof attachment.payload?.url === "string" ? [attachment.payload.url] : []);
    if (urls.length) result.set(messageId, urls);
  }
  return result;
}

function trustedInstagramUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && acceptedHosts.some((accepted) => accepted.startsWith(".") ? host.endsWith(accepted) : host === accepted) ? url : null;
  } catch { return null; }
}

function filenameFromResponse(response: Response, fallback: string, index: number) {
  const match = /filename\*?=(?:UTF-8''|\")?([^;\"]+)/i.exec(response.headers.get("content-disposition") ?? "");
  const value = match?.[1] ? decodeURIComponent(match[1].trim()) : "";
  return value.slice(0, 240) || `${fallback}-${index + 1}`;
}

/** Fetches provider-issued URLs immediately after signature verification. URLs,
 * query tokens and redirect targets are never stored in the database. */
export async function downloadEphemeralInstagramMedia(urls: string[], fallback = "instagram-media"): Promise<MediaAttachment[]> {
  const attachments: MediaAttachment[] = [];
  for (const [index, value] of urls.entries()) {
    const url = trustedInstagramUrl(value);
    if (!url) throw new Error("untrusted_instagram_media_url");
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(25_000) });
    if (!response.ok) throw new Error(`instagram_media_${response.status}`);
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
    const length = Number(response.headers.get("content-length") ?? "0");
    if (!Number.isFinite(length) || length > 100 * 1024 * 1024) throw new Error("instagram_media_too_large");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 100 * 1024 * 1024) throw new Error("instagram_media_too_large");
    attachments.push({ filename: filenameFromResponse(response, fallback, index), mimeType: contentType, bytes });
  }
  return attachments;
}
