import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptCredential, encryptCredential } from "@/lib/connectors/credential-crypto";
import { microsoftConfig } from "@/lib/connectors/microsoft-oauth";
import { microsoftGraphConnector } from "@/lib/connectors/microsoft-graph";
import { verifiedRecipient } from "./repository";
import type { Plan } from "./model";

export function followUpMail(plan: Plan) {
  if (!plan.recipientPersonId || !/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(plan.recipient) || !plan.draft.trim()) throw new Error("Verifierad rådgivare och text krävs.");
  return { message: { subject: `Uppföljning: ${plan.evidence.title}`.slice(0, 250), body: { contentType: "Text", content: plan.draft }, toRecipients: [{ emailAddress: { address: plan.recipient } }] }, saveToSentItems: true };
}
/** A new email, not a reply to the user's own outgoing email. Only called after atomic claim. */
export async function sendOutlookFollowUp(db: SupabaseClient, owner: string, plan: Plan, origin: string) {
  const e = plan.evidence, body = followUpMail(plan);
  const recipient = await verifiedRecipient(db, owner, plan.recipientPersonId!);
  if (recipient.recipient !== plan.recipient || e.personId !== plan.recipientPersonId) throw new Error("Rådgivarens identitet har ändrats.");
  const { data: conversation, error: ce } = await db.from("conversations").select("id").eq("owner_id", owner).eq("id", e.conversationId).eq("connection_id", e.connectionId!).eq("person_id", plan.recipientPersonId!).maybeSingle();
  if (ce || !conversation) throw new Error("Rådgivarens konversation kunde inte verifieras.");
  const { data: account, error } = await db.from("connections").select("id,account_identifier,encrypted_credentials").eq("owner_id", owner).eq("id", e.connectionId!).eq("provider", "microsoft-graph").eq("status", "connected").maybeSingle();
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (error || !account?.encrypted_credentials || !key || account.account_identifier !== e.account) throw new Error("Outlook-kontot kunde inte verifieras.");
  let credentials = decryptCredential<{ accessToken: string; refreshToken?: string; expiresAt: string }>(account.encrypted_credentials, key);
  if (!(Date.parse(credentials.expiresAt) > Date.now() + 60000)) {
    if (!credentials.refreshToken) throw new Error("Återanslut Outlook.");
    const config = microsoftConfig(origin);
    const refreshed = await fetch(`https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: credentials.refreshToken, scope: microsoftGraphConnector.scopes.join(" ") }), signal: AbortSignal.timeout(15000) });
    if (!refreshed.ok) throw new Error("Återanslut Outlook.");
    const token = await refreshed.json();
    if (!token.access_token || !token.expires_in) throw new Error("Outlook-token saknas.");
    credentials = { ...credentials, accessToken: token.access_token, refreshToken: token.refresh_token ?? credentials.refreshToken, expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString() };
    const saved = await db.from("connections").update({ encrypted_credentials: encryptCredential(credentials, key) }).eq("owner_id", owner).eq("id", account.id);
    if (saved.error) throw new Error("Outlook-behörigheten kunde inte sparas.");
  }
  const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", { method: "POST", headers: { authorization: `Bearer ${credentials.accessToken}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  if (response.status !== 202) throw new Error("Outlook-resultatet behöver kontrolleras. Ingen automatisk omsändning görs.");
  const sentAt = new Date().toISOString();
  const saved = await db.from("messages").insert({ owner_id: owner, conversation_id: e.conversationId, external_message_id: `local-sent-${crypto.randomUUID()}`, direction: "out", source: "email", body_text: plan.draft, sent_at: sentAt, processed_at: sentAt, metadata: { provider: "microsoft-graph", sent_with_owner_approval: true, assistant_follow_up: true } });
  const updated = await db.from("conversations").update({ last_user_message_at: sentAt, updated_at: sentAt }).eq("owner_id", owner).eq("id", e.conversationId);
  return { success: true, sentAt, newEmail: true, warning: saved.error || updated.error ? "Outlook accepterade uppföljningen men lokal historik behöver synkroniseras. Skicka inte igen." : undefined };
}
