import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

type CleanupAction = "archive" | "mark_read" | "move_to_junk" | "unsubscribe_review";
type CleanupGroup = {
  key: string;
  account: string;
  sender: string;
  senderAddress: string;
  count: number;
  unread: number;
  categories: string[];
  lastSeenAt: string;
  action: CleanupAction;
  reason: string;
  unsubscribeUrl?: string;
};

const lowValueCategories = new Set(["Newsletter", "Marketing", "Notification", "Spam", "Information Only"]);
const publicMailboxDomains = new Set(["gmail.com", "hotmail.com", "outlook.com", "icloud.com", "yahoo.com", "live.com"]);

function domainOf(address: string) { return address.toLowerCase().split("@")[1] ?? ""; }
function unsubscribeUrl(body?: string | null) {
  const urls = body?.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  return urls.find((url) => /unsubscribe|opt.?out|manage.?preferences|email.?preferences/i.test(url));
}

function actionFor(categories: Set<string>): { action: CleanupAction; reason: string } {
  if (categories.has("Spam")) return { action: "move_to_junk", reason: "Messages classified as spam should be reviewed for the junk folder." };
  if (categories.has("Newsletter") || categories.has("Marketing")) return { action: "unsubscribe_review", reason: "Recurring marketing or newsletter sender; review before unsubscribing or archiving." };
  if (categories.has("Notification")) return { action: "mark_read", reason: "Automated notifications can usually be marked as read after review." };
  return { action: "archive", reason: "Low-attention informational messages can be reviewed for archiving." };
}

export async function GET(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) return NextResponse.json({ error: "Your session has expired. Sign in again." }, { status: 401 });
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.json({ error: "Two-factor authentication is required." }, { status: 403 });

  const { data: messages, error } = await database.from("messages")
    .select("id,sender_identity_id,conversation_id,classification,sent_at,metadata,body_text")
    .eq("owner_id", user.id).eq("direction", "in").order("sent_at", { ascending: false }).limit(1000);
  if (error) return NextResponse.json({ error: "The inbox could not be analyzed." }, { status: 500 });
  const relevantMessages = (messages ?? []).filter((message) => lowValueCategories.has(message.classification ?? ""));
  const identityIds = [...new Set(relevantMessages.flatMap((message) => message.sender_identity_id ? [message.sender_identity_id] : []))];
  const conversationIds = [...new Set(relevantMessages.map((message) => message.conversation_id))];
  const { data: identities } = identityIds.length ? await database.from("identities").select("id,external_identifier,person_id").eq("owner_id", user.id).in("id", identityIds) : { data: [] };
  const personIds = [...new Set((identities ?? []).map((identity) => identity.person_id))];
  const { data: people } = personIds.length ? await database.from("people").select("id,display_name").eq("owner_id", user.id).in("id", personIds) : { data: [] };
  const { data: conversations } = conversationIds.length ? await database.from("conversations").select("id,connection_id").eq("owner_id", user.id).in("id", conversationIds) : { data: [] };
  const connectionIds = [...new Set((conversations ?? []).flatMap((conversation) => conversation.connection_id ? [conversation.connection_id] : []))];
  const { data: connections } = connectionIds.length ? await database.from("connections").select("id,account_name,account_identifier,provider").eq("owner_id", user.id).in("id", connectionIds) : { data: [] };
  const { data: connectedMailboxes } = await database.from("connections").select("account_identifier").eq("owner_id", user.id).eq("status", "connected").in("provider", ["microsoft-graph", "gmail"]);
  const trustedInternalDomains = new Set((connectedMailboxes ?? []).map((mailbox) => domainOf(mailbox.account_identifier ?? "")).filter((domain) => domain && !publicMailboxDomains.has(domain)));
  const identityMap = new Map((identities ?? []).map((identity) => [identity.id, identity]));
  const personMap = new Map((people ?? []).map((person) => [person.id, person.display_name ?? "Unknown sender"]));
  const conversationMap = new Map((conversations ?? []).map((conversation) => [conversation.id, conversation.connection_id]));
  const connectionMap = new Map((connections ?? []).map((connection) => [connection.id, connection]));
  const groups = new Map<string, CleanupGroup & { categorySet: Set<string> }>();

  for (const message of relevantMessages) {
    const identity = identityMap.get(message.sender_identity_id ?? "");
    const connectionId = conversationMap.get(message.conversation_id) ?? "unknown";
    const connection = connectionMap.get(connectionId ?? "");
    const address = identity?.external_identifier ?? "Unknown address";
    if (trustedInternalDomains.has(domainOf(address))) continue;
    const key = `${connectionId}:${address}`;
    const category = message.classification ?? "Information Only";
    const metadata = message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata) ? message.metadata as { is_read?: boolean; gmail_labels?: string[] } : {};
    const unread = metadata.is_read === false || metadata.gmail_labels?.includes("UNREAD") === true;
    const current = groups.get(key) ?? { key, account: connection?.account_name || connection?.account_identifier || "Unknown account", sender: personMap.get(identity?.person_id ?? "") ?? address, senderAddress: address, count: 0, unread: 0, categories: [], categorySet: new Set<string>(), lastSeenAt: message.sent_at, action: "archive", reason: "", unsubscribeUrl: unsubscribeUrl(message.body_text) };
    current.count += 1; if (unread) current.unread += 1; current.categorySet.add(category);
    current.unsubscribeUrl ||= unsubscribeUrl(message.body_text);
    if (message.sent_at > current.lastSeenAt) current.lastSeenAt = message.sent_at;
    groups.set(key, current);
  }
  const suggestions = [...groups.values()].map((group) => { const recommendation = actionFor(group.categorySet); return { ...group, categories: [...group.categorySet], categorySet: undefined, ...recommendation }; }).sort((a, b) => b.count - a.count).slice(0, 250);
  return NextResponse.json({ analyzed: messages?.length ?? 0, lowValueMessages: relevantMessages.length, suggestions });
}
