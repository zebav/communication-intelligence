export function instagramMessagesUrl(accountId: string, version = process.env.META_GRAPH_API_VERSION || "v23.0") {
  if (!/^\d+$/.test(accountId)) throw new Error("invalid_instagram_account_id");
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("invalid_meta_graph_version");
  return `https://graph.instagram.com/${version}/${accountId}/messages`;
}

export function instagramConversationsUrl(accountId: string, version = process.env.META_GRAPH_API_VERSION || "v23.0") {
  if (!/^\d+$/.test(accountId)) throw new Error("invalid_instagram_account_id");
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("invalid_meta_graph_version");
  const url = new URL(`https://graph.instagram.com/${version}/${accountId}/conversations`);
  // This is a repair path for missed webhooks, not a historical import. Keep
  // it deliberately small so one slow Meta response cannot block all other
  // background work.
  url.searchParams.set("fields", "messages.limit(8){id,from,to,message,created_time}");
  url.searchParams.set("limit", "8");
  return url.toString();
}

export function instagramUserProfileUrl(participantId: string, version = process.env.META_GRAPH_API_VERSION || "v23.0") {
  if (!/^\d+$/.test(participantId)) throw new Error("invalid_instagram_participant_id");
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("invalid_meta_graph_version");
  const url = new URL(`https://graph.instagram.com/${version}/${participantId}`);
  url.searchParams.set("fields", "name,username");
  return url.toString();
}

export function instagramSendBody(participantId: string, text: string) {
  if (!/^\d+$/.test(participantId)) throw new Error("invalid_instagram_participant_id");
  const message = text.trim();
  if (!message || message.length > 4000) throw new Error("invalid_instagram_message");
  return { recipient: { id: participantId }, message: { text: message } };
}
