/**
 * Keeps one canonical conversation for a provider thread without collapsing
 * separate threads from the same channel. Imported rows may legitimately be
 * duplicated during a connector replay; an external conversation id is the
 * stable way to recognise that case.
 */
export function deduplicatePersonConversations<T extends {
  id: string;
  source: string;
  external_conversation_id?: string | null;
  created_at?: string | null;
  last_message_at?: string | null;
}>(rows: T[]): T[] {
  const grouped = new Map<string, T>();

  for (const row of rows) {
    const externalId = row.external_conversation_id?.trim();
    const key = `${row.source}:${externalId || row.id}`;
    const current = grouped.get(key);
    const rowTime = String(row.last_message_at ?? row.created_at ?? "");
    const currentTime = String(current?.last_message_at ?? current?.created_at ?? "");
    if (!current || rowTime > currentTime) grouped.set(key, row);
  }

  return [...grouped.values()];
}
