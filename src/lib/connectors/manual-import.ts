export type ImportedLine = { sender: string; body: string; sentAt?: string };

const datedLine = /^\s*\[([^\]]+)]\s*([^:]{1,120}):\s*(.+)$/;
const simpleLine = /^\s*([^:]{1,120}):\s*(.+)$/;

export function parseImportedConversation(raw: string): ImportedLine[] {
  const text = raw.trim();
  if (!text) return [];
  try {
    const json = JSON.parse(text) as unknown;
    if (Array.isArray(json)) return json.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const value = item as Record<string, unknown>;
      const sender = String(value.sender ?? value.from ?? "Unknown").trim();
      const body = String(value.body ?? value.text ?? value.message ?? "").trim();
      const sentAt = typeof (value.sentAt ?? value.timestamp ?? value.date) === "string" ? String(value.sentAt ?? value.timestamp ?? value.date) : undefined;
      return body ? [{ sender, body, sentAt }] : [];
    });
  } catch { /* Text exports continue below. */ }

  const parsed: ImportedLine[] = [];
  for (const line of text.split(/\r?\n/)) {
    const dated = line.match(datedLine);
    const simple = line.match(simpleLine);
    if (dated) parsed.push({ sentAt: dated[1], sender: dated[2].trim(), body: dated[3].trim() });
    else if (simple) parsed.push({ sender: simple[1].trim(), body: simple[2].trim() });
    else if (line.trim() && parsed.length) parsed[parsed.length - 1].body += `\n${line.trim()}`;
  }
  return parsed.length ? parsed : [{ sender: "Unknown", body: text }];
}

export function validImportedDate(value: string | undefined, fallback: Date) {
  if (!value || Number.isNaN(Date.parse(value))) return fallback.toISOString();
  return new Date(value).toISOString();
}
