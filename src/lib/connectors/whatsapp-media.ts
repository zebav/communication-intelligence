import type { MediaAttachment } from "@/lib/media/email-worker";

type RawMessage = { id?: unknown; image?: { id?: unknown }; audio?: { id?: unknown }; video?: { id?: unknown }; document?: { id?: unknown }; sticker?: { id?: unknown } };
type RawPayload = { object?: unknown; entry?: Array<{ changes?: Array<{ field?: unknown; value?: { messages?: RawMessage[] } }> }> };
const trustedHosts = ["lookaside.fbsbx.com", ".fbcdn.net", ".cdninstagram.com"];

export function ephemeralMetaWhatsAppMediaIds(rawBody: string) {
  let payload: RawPayload;
  try { payload = JSON.parse(rawBody) as RawPayload; } catch { return new Map<string, string[]>(); }
  if (payload.object !== "whatsapp_business_account") return new Map<string, string[]>();
  const output = new Map<string, string[]>();
  for (const entry of payload.entry ?? []) for (const change of entry.changes ?? []) {
    if (change.field !== "messages") continue;
    for (const message of change.value?.messages ?? []) {
      const messageId = typeof message.id === "string" ? message.id.trim() : "";
      const mediaId = [message.image?.id, message.audio?.id, message.video?.id, message.document?.id, message.sticker?.id].find((id): id is string => typeof id === "string" && /^\d+$/.test(id));
      if (messageId && mediaId) output.set(messageId, [mediaId]);
    }
  }
  return output;
}

function trustedDownloadUrl(value: string) {
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    return url.protocol === "https:" && trustedHosts.some((trusted) => trusted.startsWith(".") ? host.endsWith(trusted) : host === trusted) ? url : null;
  } catch { return null; }
}

export async function downloadMetaWhatsAppMedia(accessToken: string, mediaIds: string[], version = process.env.META_GRAPH_API_VERSION || "v26.0"): Promise<MediaAttachment[]> {
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("invalid_meta_graph_version");
  const files: MediaAttachment[] = [];
  for (const mediaId of mediaIds) {
    if (!/^\d+$/.test(mediaId)) throw new Error("invalid_whatsapp_media_id");
    const metadataResponse = await fetch(`https://graph.facebook.com/${version}/${mediaId}`, { headers: { authorization: `Bearer ${accessToken}` }, redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!metadataResponse.ok) throw new Error(`whatsapp_media_metadata_${metadataResponse.status}`);
    const metadata = await metadataResponse.json() as { url?: unknown; mime_type?: unknown; file_size?: unknown; id?: unknown };
    const url = typeof metadata.url === "string" ? trustedDownloadUrl(metadata.url) : null;
    if (!url) throw new Error("untrusted_whatsapp_media_url");
    if (typeof metadata.file_size === "number" && metadata.file_size > 100 * 1024 * 1024) throw new Error("whatsapp_media_too_large");
    const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` }, redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`whatsapp_media_download_${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 100 * 1024 * 1024) throw new Error("whatsapp_media_too_large");
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || (typeof metadata.mime_type === "string" ? metadata.mime_type.toLowerCase() : "application/octet-stream");
    files.push({ filename: `whatsapp-${typeof metadata.id === "string" ? metadata.id : mediaId}`, mimeType, bytes });
  }
  return files;
}
