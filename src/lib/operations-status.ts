/**
 * Converts internal worker codes into short, safe operator-facing status text.
 * Raw provider errors can contain URLs or implementation detail and are never
 * returned by the Operations API.
 */
export function safeOperationFailureSummary(code: string | null | undefined) {
  const value = code?.toLowerCase() ?? "";
  if (!value) return "Ett bakgrundsjobb kunde inte slutföras.";
  if (value.includes("reconnect") || value.includes("credential") || value.includes("connection_")) {
    return "En anslutning behöver loggas in igen.";
  }
  if (value.startsWith("gmail_") || value.startsWith("outlook_") || value.startsWith("whatsapp_media_") || value.startsWith("media_fetch_")) {
    return "Källfilen kunde inte hämtas från den anslutna tjänsten.";
  }
  if (value.startsWith("audio_") || value.startsWith("document_analysis_") || value.startsWith("openai_") || value.includes("analysis")) {
    return "Innehållet kunde inte analyseras ännu.";
  }
  if (value.includes("timeout")) return "Arbetet tog för lång tid och köas om när det är säkert.";
  if (value.includes("upload") || value.includes("storage") || value.includes("asset_save")) {
    return "Filen kunde inte sparas säkert ännu.";
  }
  return "Ett bakgrundsjobb kunde inte slutföras.";
}
