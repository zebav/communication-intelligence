/**
 * Email signatures often contain tiny inline logos and social-media icons.
 * They are not user-sent media and must never enter the private media vault.
 */
export type EmailAttachmentDescriptor = {
  filename?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  isInline?: boolean | null;
  contentId?: string | null;
  contentDisposition?: string | null;
};

const signatureFilename = /^(?:image\d{1,4}|mime-attachment|logo|icon|email-signature|signature)(?:[-_. ]\d+)?\.(?:png|jpe?g|gif|webp|svg)$/i;
const brandedSignatureFilename = /(?:^|[-_. ])(?:facebook|instagram|linkedin|youtube|twitter|x|tiktok|pinterest|spotify|website|web|mail|phone|calendar|logo|icon)(?:[-_. ]|$)/i;

export function isDecorativeEmailSignatureAttachment(input: EmailAttachmentDescriptor) {
  const mimeType = (input.mimeType ?? "").toLowerCase();
  if (!mimeType.startsWith("image/")) return false;
  if (input.isInline || input.contentId || /\binline\b/i.test(input.contentDisposition ?? "")) return true;

  const filename = (input.filename ?? "").trim();
  const sizeBytes = Number(input.sizeBytes ?? 0);
  // A normal photo attached to an email may be named image001.png, so only
  // use filename heuristics for small assets typical of a signature block.
  return sizeBytes > 0 && sizeBytes <= 512 * 1024 && (signatureFilename.test(filename) || brandedSignatureFilename.test(filename));
}
