/** Graph replies use Reply-To rather than From when present. Never approve one and send to another. */
export function matchesReplyRecipient(message: { replyTo?: { emailAddress?: { address?: string } }[]; from?: { emailAddress?: { address?: string } } }, expected: string) {
  const recipients = message.replyTo?.length ? message.replyTo : [message.from];
  return recipients.length === 1 && Boolean(expected.trim()) && recipients[0]?.emailAddress?.address?.trim().toLowerCase() === expected.trim().toLowerCase();
}
