import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptCredential, encryptCredential } from "@/lib/connectors/credential-crypto";
import { googleConfig } from "@/lib/connectors/google-oauth";
import type { Plan } from "./model";

type Header = { name?: string; value?: string };
export function gmailReplyContent(headers: Header[], from: string, recipient: string, body: string) {
  const single = (name: string) => {
    const matches = headers.filter(h => h.name?.toLowerCase() === name.toLowerCase());
    if (matches.length > 1) throw new Error("Tvetydiga brevhuvuden.");
    return matches[0]?.value?.trim() ?? "";
  };
  const address = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
  if (!address.test(from) || !address.test(recipient)) throw new Error("Ogiltig e-postadress.");
  const target = single("Reply-To") || single("From");
  const actual = target.match(/^[^<>\r\n]*<([^<>\r\n]+)>$/)?.[1] ?? target;
  if (!address.test(actual) || actual.toLowerCase() !== recipient.toLowerCase()) throw new Error("Gmails svarsmottagare skiljer sig från den godkända adressen.");
  const messageId = single("Message-ID");
  if (!/^<[^<>\s]+>$/.test(messageId)) throw new Error("Originalets meddelande-id saknas eller är ogiltigt.");
  const subject = single("Subject");
  if (/[\r\n]/.test(subject)) throw new Error("Ogiltig ämnesrad.");
  const characters = Array.from(subject), words: string[] = [];
  for (let i = 0; i < characters.length; i += 10) words.push(`=?UTF-8?B?${Buffer.from(characters.slice(i, i + 10).join(""), "utf8").toString("base64")}?=`);
  const encodedSubject = words.join("\r\n ");
  const encodedBody = Buffer.from(body, "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
  return Buffer.from([`From: ${from}`, `To: ${recipient}`, `Subject: ${encodedSubject}`, `In-Reply-To: ${messageId}`, `References: ${messageId}`, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", encodedBody].join("\r\n")).toString("base64url");
}

/** Called only after the assistant's atomic approval claim; never retries sending. */
export async function sendApprovedGmailReply(db: SupabaseClient, owner: string, plan: Plan, originalId: string, origin: string) {
  const e = plan.evidence;
  const { data: connection, error } = await db.from("connections").select("id,account_identifier,encrypted_credentials").eq("owner_id", owner).eq("id", e.connectionId!).eq("provider", "gmail").eq("status", "connected").maybeSingle();
  if (error || !connection?.encrypted_credentials || connection.account_identifier !== e.account) throw new Error("Gmail-kontot har ändrats.");
  const { data: original, error: originalError } = await db.from("messages").select("external_message_id").eq("owner_id", owner).eq("id", originalId).eq("conversation_id", e.conversationId).eq("source", "email").eq("direction", "in").maybeSingle();
  const id = original?.external_message_id?.split(":").at(-1);
  if (originalError || !original || !id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Gmail-originalet kunde inte verifieras.");
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!key) throw new Error("Krypteringsnyckel saknas.");
  let credentials = decryptCredential<{ accessToken: string; refreshToken?: string; expiresAt: string; scope?: string }>(connection.encrypted_credentials, key);
  if (!(Date.parse(credentials.expiresAt) > Date.now() + 60000)) {
    if (!credentials.refreshToken) throw new Error("Återanslut Gmail.");
    const config = googleConfig(origin);
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: credentials.refreshToken }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("Återanslut Gmail.");
    const token = await response.json();
    if (!token.access_token || !token.expires_in) throw new Error("Gmail-token saknas.");
    credentials = { ...credentials, accessToken: token.access_token, refreshToken: token.refresh_token ?? credentials.refreshToken, scope: token.scope ?? credentials.scope, expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString() };
    const saved = await db.from("connections").update({ encrypted_credentials: encryptCredential(credentials, key) }).eq("owner_id", owner).eq("id", connection.id);
    if (saved.error) throw new Error("Gmail-behörigheten kunde inte sparas.");
  }
  const headers = { authorization: `Bearer ${credentials.accessToken}` };
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata`, { headers, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Gmail-originalet kunde inte kontrolleras.");
  const message = await response.json();
  if (typeof message.threadId !== "string" || !message.threadId || !Array.isArray(message.payload?.headers)) throw new Error("Gmail-tråden saknas.");
  const raw = gmailReplyContent(message.payload.headers, connection.account_identifier, plan.recipient, plan.draft);
  const sent = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ raw, threadId: message.threadId }), signal: AbortSignal.timeout(20000) });
  if (!sent.ok) throw new Error("Gmail-resultatet behöver kontrolleras. Skicka inte igen automatiskt.");
  const receipt = await sent.json();
  if (typeof receipt.id !== "string" || !receipt.id) throw new Error("Gmail saknar sändningskvitto.");
  const sentAt = new Date().toISOString();
  const prefix = original.external_message_id.slice(0, original.external_message_id.lastIndexOf(":") + 1);
  const saved = await db.from("messages").upsert({ owner_id: owner, conversation_id: e.conversationId, external_message_id: `${prefix}${receipt.id}`, direction: "out", source: "email", body_text: plan.draft, sent_at: sentAt, processed_at: sentAt, metadata: { provider: "gmail", sent_with_owner_approval: true, connection_id: connection.id } }, { onConflict: "owner_id,source,external_message_id", ignoreDuplicates: true });
  const updated = await db.from("conversations").update({ last_user_message_at: sentAt, last_message_at: sentAt, updated_at: sentAt }).eq("owner_id", owner).eq("id", e.conversationId);
  return { success: true, sentAt, externalId: receipt.id, warning: saved.error || updated.error ? "Gmail accepterade svaret men lokal historik behöver synkroniseras. Skicka inte igen." : undefined };
}
