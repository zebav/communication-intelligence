export type ConversationMessage = {
  id?: string;
  direction: "in" | "out";
  body: string | null;
  sentAt: string | null;
};

function stockholmDay(value: string) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date(value));
}

function clock(value: string) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

/**
 * Treat consecutive incoming messages from one person on the same local day as
 * one turn. The run stops at the user's latest reply, so the AI never blends
 * messages across a completed exchange.
 */
export function inboundBurst(messages: ConversationMessage[], targetId?: string) {
  const ordered = messages
    .filter((message) => message.body?.trim() && message.sentAt)
    .sort((a, b) => Date.parse(a.sentAt!) - Date.parse(b.sentAt!));
  const target = targetId ? ordered.find((message) => message.id === targetId) : ordered.at(-1);
  if (!target?.sentAt) return { text: target?.body?.trim() ?? "", messageIds: target?.id ? [target.id] : [], count: target?.body ? 1 : 0 };

  const targetIndex = ordered.indexOf(target);
  const lastOutgoing = ordered.slice(0, targetIndex + 1).map((message, index) => ({ message, index })).filter(({ message }) => message.direction === "out").at(-1)?.index ?? -1;
  const sameTurn = ordered.slice(lastOutgoing + 1, targetIndex + 1)
    .filter((message) => message.direction === "in" && message.sentAt && stockholmDay(message.sentAt) === stockholmDay(target.sentAt!));
  const selected = sameTurn.length ? sameTurn : [target];
  return {
    text: selected.map((message) => `[${clock(message.sentAt!)}] ${message.body!.trim()}`).join("\n\n"),
    messageIds: selected.flatMap((message) => message.id ? [message.id] : []),
    count: selected.length,
  };
}
