type Thread = { id: string; title: string | null; last_user_message_at: string | null; last_other_message_at: string | null };
const subject = (value: string) => value.replace(/^(\s*(re|fw|fwd|sv|vb)\s*:\s*)+/gi, "").trim().toLocaleLowerCase();
/** Rows must already be scoped to the reviewed advisor, owner and originating account. */
export function chooseAdvisorConversation(rows: Thread[], originalTitle: string, acceptedAt: string): Thread | null {
  if (!originalTitle.trim() || !Number.isFinite(Date.parse(acceptedAt))) return null;
  const matches = rows.filter(c => subject(c.title ?? "") === subject(originalTitle) && c.last_user_message_at && Date.parse(c.last_user_message_at) >= Date.parse(acceptedAt) - 60_000);
  if (matches.length !== 1) return null;
  const chosen = matches[0];
  if (chosen.last_other_message_at && Date.parse(chosen.last_other_message_at) >= Date.parse(acceptedAt)) return null;
  return chosen;
}
