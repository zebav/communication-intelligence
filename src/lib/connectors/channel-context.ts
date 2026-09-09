import type { Source } from "@/lib/domain";

const guidance: Record<Source, string> = {
  email: "Use an email structure when useful: clear opening, complete answer, and appropriate sign-off.",
  imessage: "Use a natural, concise chat style that matches the existing personal relationship.",
  instagram: "Use a concise direct-message style and preserve the relationship's established tone.",
  whatsapp: "Use a conversational chat style, short paragraphs, and avoid unnecessary formality.",
  messenger: "Use a concise direct-message style and make the next action easy to understand.",
  tinder: "Use natural personal language. Never automate sending or impersonate the owner.",
  tiktok: "Use a brief direct-message style appropriate to the existing conversation.",
  linkedin: "Use a professional but human direct-message style with a clear purpose.",
  manual: "Infer the format from the owner-provided context and do not assume a specific platform.",
};

export function channelWritingGuidance(source: Source) {
  return guidance[source];
}
