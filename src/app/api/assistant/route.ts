import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { candidateRank, editSchema, kinds, makePlan, propose, sendCapability, type Task } from "@/lib/assistant/model";
import { changeTask, generateDraft, persistDraftAnalysis, readCandidates, readEvidence, readTask, verifiedRecipient } from "@/lib/assistant/repository";
import { executeApprovedTask } from "@/lib/assistant/execution";
import { browserReadiness } from "@/lib/assistant/browser-readiness";
import { chooseAdvisorConversation } from "@/lib/assistant/follow-up";
import { sendApprovedGmailReply } from "@/lib/assistant/gmail-reply";
import { sendOutlookFollowUp } from "@/lib/assistant/outlook-follow-up";
import { POST as outlookReply } from "@/app/api/connectors/microsoft/reply/route";
import { POST as outlookForward } from "@/app/api/connectors/microsoft/forward/route";
import { POST as instagramReply } from "@/app/api/connectors/instagram/reply/route";
import { POST as whatsappReply } from "@/app/api/connectors/whatsapp/reply/route";
export const maxDuration = 120;
const base = { id: z.string().uuid(), revision: z.number().int().positive() };
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), messageId: z.string().uuid(), kind: z.enum(kinds) }),
  z.object({ action: z.literal("dismiss_candidate"), messageId: z.string().uuid(), kind: z.enum(kinds), scope: z.enum(["message", "sender"]).optional() }),
  z.object({ action: z.literal("save"), ...base, edit: editSchema }),
  z.object({ action: z.literal("generate"), ...base }),
  z.object({ action: z.literal("execute"), ...base, approved: z.literal(true) }),
  z.object({ action: z.literal("dismiss"), ...base }),
  z.object({ action: z.literal("complete"), ...base, note: z.string().trim().min(5).max(1000) }),
  z.object({ action: z.literal("follow_up"), ...base }),
  z.object({ action: z.literal("reconcile"), ...base }),
  z.object({ action: z.literal("feedback"), id: z.string().uuid(), category: z.enum(["wrong_recipient", "not_relevant", "missed_task", "draft_edited", "useful"]), note: z.string().trim().min(3).max(1000) }),
]);
async function session() {
  const db = await createClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) throw new Error("Logga in igen.");
  const { data, error: aalError } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalError || data?.currentLevel !== "aal2") throw new Error("Tvåfaktorsinloggning krävs.");
  return { db, owner: user.id };
}
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: Request) {
  try {
    const { db, owner } = await session();
    const cursor = z.coerce.number().int().min(0).max(100000).parse(new URL(request.url).searchParams.get("cursor") ?? 0);
    const [page, tasks, feedback, calendar, relevanceRules] = await Promise.all([
      readCandidates(db, owner, String(cursor)),
      db.from("assistant_tasks").select("*").eq("owner_id", owner).order("updated_at", { ascending: false }).limit(500),
      db.from("assistant_task_feedback").select("category").eq("owner_id", owner).order("created_at", { ascending: false }).limit(1000),
      db.from("calendar_workspace").select("timezone").eq("owner_id", owner).maybeSingle(),
      db.from("learning_signals").select("person_id,source,evidence").eq("owner_id", owner).eq("signal_type", "category_corrected").eq("status", "approved").limit(1000),
    ]);
    if (tasks.error || feedback.error || relevanceRules.error) throw new Error("Handlingsinkorgens databas behöver installeras eller kunde inte läsas. Inga uppdrag har tagits bort.");
    const evidenceByMessage = new Map(page.messages.map(evidence => [evidence.messageId, evidence]));
    const stored = (tasks.data as Task[]).map(task => {
      const evidence = evidenceByMessage.get(task.message_id);
      return evidence ? { ...task, plan: { ...task.plan, evidence } } : task;
    });
    const waiting = stored.filter(t => t.status === "waiting" && t.kind !== "forward");
    if (waiting.length) {
      const { data: conversations, error } = await db.from("conversations").select("id,last_other_message_at").eq("owner_id", owner).in("id", [...new Set(waiting.map(t => t.plan.evidence.conversationId))]);
      if (error) throw new Error("Svarsläget kunde inte kontrolleras. Tidigare uppgifter behålls.");
      for (const task of waiting) {
        const at = conversations?.find(c => c.id === task.plan.evidence.conversationId)?.last_other_message_at;
        if (at && task.result.acceptedAt && Date.parse(at) > Date.parse(String(task.result.acceptedAt))) task.observedReplyAt = at;
      }
    }
    const { data: existing, error: existingError } = page.messages.length ? await db.from("assistant_tasks").select("message_id,kind").eq("owner_id", owner).in("message_id", page.messages.map(m => m.messageId)) : { data: [], error: null };
    if (existingError) throw new Error("Dubblettkontrollen kunde inte slutföras.");
    const keys = new Set((existing ?? []).map(t => `${t.message_id}:${t.kind}`));
    const ignoredSenders = new Set((relevanceRules.data ?? []).filter(rule => {
      const evidence = rule.evidence && typeof rule.evidence === "object" && !Array.isArray(rule.evidence) ? rule.evidence as Record<string, unknown> : {};
      return evidence.assistant_relevance === "sender_irrelevant" && typeof rule.person_id === "string";
    }).map(rule => `${rule.source}:${rule.person_id}`));
    const lowerPrioritySenders = new Set((relevanceRules.data ?? []).filter(rule => {
      const evidence = rule.evidence && typeof rule.evidence === "object" && !Array.isArray(rule.evidence) ? rule.evidence as Record<string, unknown> : {};
      return evidence.assistant_relevance === "sender_lower_priority" && typeof rule.person_id === "string";
    }).map(rule => `${rule.source}:${rule.person_id}`));
    const candidates = page.messages.flatMap(e => ignoredSenders.has(`${e.source}:${e.personId}`) ? [] : propose(e)
      .filter(kind => !keys.has(`${e.messageId}:${kind}`))
      .map(kind => ({ messageId: e.messageId, kind, plan: makePlan(e, kind), rank: candidateRank(e, kind) - (lowerPrioritySenders.has(`${e.source}:${e.personId}`) ? 20 : 0) })))
      .sort((a, b) => b.rank - a.rank)
      .map(({ messageId, kind, plan }) => ({ messageId, kind, plan }));
    return json({ tasks: stored, candidates, reviewMessages: page.messages.map(e => ({ id: e.messageId, title: e.title, person: e.personName })), next: page.next, scanned: page.messages.length, scannedBySource: page.scannedBySource, emailWindowDays: page.emailWindowDays, tasksLimited: stored.length === 500, feedback: feedback.data, timezone: calendar.error ? null : calendar.data?.timezone ?? null, executionEnabled: process.env.ASSISTANT_EXECUTION_ENABLED === "true", browserReadiness: browserReadiness() });
  } catch (e) { return json({ error: e instanceof Error ? e.message : "Uppdragen kunde inte hämtas." }, 503); }
}
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return json({ error: "Ogiltigt ursprung." }, 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Kontrollera uppgifterna." }, 400);
  try {
    const { db, owner } = await session(), a = parsed.data;
    if (a.action === "dismiss_candidate") {
      const e = await readEvidence(db, owner, a.messageId);
      if (e.direction !== "in") throw new Error("Endast inkommande meddelanden kan sorteras bort.");
      const { data: saved, error: saveError } = await db.from("assistant_tasks").upsert({
        owner_id: owner, message_id: e.messageId, kind: a.kind, status: "dismissed", plan: makePlan(e, a.kind),
      }, { onConflict: "owner_id,message_id,kind", ignoreDuplicates: true }).select("*").maybeSingle();
      if (saveError) throw new Error("Meddelandet kunde inte sorteras bort.");
      let task = saved;
      if (!task) {
        const { data, error } = await db.from("assistant_tasks").select("*").eq("owner_id", owner).eq("message_id", e.messageId).eq("kind", a.kind).single();
        if (error || !data) throw new Error("Den sparade korrigeringen kunde inte läsas.");
        task = data;
      }
      const note = "Detta ärende är inte relevant. Sänk avsändarens framtida prioritet utan att blockera personen.";
      const { error: feedbackError } = await db.from("assistant_task_feedback").insert({
        owner_id: owner, task_id: task.id, category: "not_relevant", note,
      });
      if (feedbackError) throw new Error("Meddelandet sorterades bort men korrigeringen kunde inte sparas.");
      const { error: priorityError } = await db.from("priority_feedback").upsert({
        owner_id: owner, message_id: e.messageId, person_id: e.personId, source: e.source,
        category: e.classification || "Unknown", score: 1, reason: note,
      }, { onConflict: "owner_id,message_id" });
      if (priorityError) throw new Error("Meddelandet sorterades bort men prioritetskorrigeringen kunde inte sparas.");
      if (e.personId) {
        const { data: existingRule } = await db.from("learning_signals").select("id").eq("owner_id", owner)
          .eq("person_id", e.personId).eq("source", e.source).eq("signal_type", "category_corrected")
          .eq("status", "approved").contains("evidence", { assistant_relevance: "sender_lower_priority" }).limit(1).maybeSingle();
        if (!existingRule) {
          const { error: learningError } = await db.from("learning_signals").insert({
            owner_id: owner,
            person_id: e.personId,
            conversation_id: e.conversationId,
            source: e.source,
            signal_type: "category_corrected",
            observation: `Du markerade ett ärende från ${e.personName} som inte relevant i handlingsinkorgen.`,
            proposed_rule: `Prioritera ${e.personName} lägre i framtida handlingsförslag på ${e.source}, men blockera inte personen.`,
            evidence: { assistant_relevance: "sender_lower_priority", message_id: e.messageId },
            confidence: 0.85,
            status: "approved",
          });
          if (learningError) throw new Error("Meddelandet sorterades bort men avsändarens prioritetsregel kunde inte sparas.");
        }
      }
      return json({ saved: true });
    }
    if (a.action === "start") {
      const e = await readEvidence(db, owner, a.messageId);
      if (e.direction !== "in" && a.kind !== "follow_up") throw new Error("Välj ett inkommande originalmeddelande.");
      // The owner explicitly asked to prepare this decision. Research/planning may run here,
      // but no external message, calendar booking or website side effect is authorized.
      const initialPlan = makePlan(e, a.kind);
      const { prepareDecisionPlan } = await import("@/lib/assistant/preparation");
      const preparedPlan = await prepareDecisionPlan(db, owner, initialPlan, a.kind);
      const { data, error } = await db.from("assistant_tasks").upsert({
        owner_id: owner, message_id: e.messageId, kind: a.kind, plan: preparedPlan,
      }, { onConflict: "owner_id,message_id,kind", ignoreDuplicates: true }).select("*").maybeSingle();
      if (error) throw new Error("Uppdraget kunde inte sparas.");
      if (data) {
        const created = data as Task;
        const canSendPrepared = !sendCapability(preparedPlan, a.kind) && ["reply", "follow_up", "meeting"].includes(a.kind) && preparedPlan.preparation?.status === "ready";
        return json({ task: canSendPrepared ? await changeTask(db, owner, created, "ready", preparedPlan) : created });
      }
      const { data: existing, error: read } = await db.from("assistant_tasks").select("*").eq("owner_id", owner).eq("message_id", e.messageId).eq("kind", a.kind).single();
      if (read) throw new Error("Uppdraget finns redan men kunde inte läsas.");
      return json({ task: existing, duplicate: true });
    }
    const task = await readTask(db, owner, a.id);
    if (a.action === "feedback") {
      const { error } = await db.from("assistant_task_feedback").insert({ owner_id: owner, task_id: task.id, category: a.category, note: a.note });
      if (error) throw new Error("Korrigeringen kunde inte sparas.");
      return json({ saved: true });
    }
    if (task.revision !== a.revision) throw new Error("Uppdraget har ändrats. Hämta och granska den senaste versionen.");
    if (a.action === "reconcile") {
      if (task.kind !== "meeting" || !["decision", "ready"].includes(task.status)) return json({ task });
      const { data: hold, error } = await db.from("calendar_holds").select("id,external_event_id").eq("owner_id", owner).eq("conversation_id", task.plan.evidence.conversationId).eq("status", "confirmed").gte("created_at", task.created_at).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error("Bokningens resultat kunde inte läsas. Boka inte igen.");
      return json({ task: hold ? await changeTask(db, owner, task, "done", task.plan, { holdId: hold.id, eventId: hold.external_event_id, confirmedBooking: true }) : task });
    }
    if (a.action === "dismiss") return json({ task: await changeTask(db, owner, task, "dismissed") });
    if (a.action === "complete") {
      return json({ task: await changeTask(db, owner, task, "done", task.plan, { ...task.result, manuallyConfirmed: true, note: a.note }) });
    }
    const fresh = await readEvidence(db, owner, task.message_id);
    if (a.action === "follow_up") {
      if (task.kind === "website") throw new Error("Granska webbresultatet; ingen meddelandeuppföljning har godkänts.");
      if (task.status !== "waiting") throw new Error("Uppdraget väntar inte på svar.");
      let conversationId = fresh.conversationId;
      if (task.kind === "forward") {
        if (!task.plan.recipientPersonId || !fresh.connectionId) throw new Error("Rådgivaren eller ursprungskontot kunde inte verifieras.");
        const { data: threads, error } = await db.from("conversations").select("id,title,last_user_message_at,last_other_message_at").eq("owner_id", owner).eq("person_id", task.plan.recipientPersonId).eq("connection_id", fresh.connectionId).order("last_user_message_at", { ascending: false }).limit(30);
        if (error) throw new Error("Rådgivarens konversationer kunde inte läsas.");
        const match = chooseAdvisorConversation(threads ?? [], fresh.title, String(task.result.acceptedAt ?? ""));
        if (!match) throw new Error("Ingen entydig obesvarad tråd med rådgivaren hittades för detta ärende. Synkronisera Skickat och kontrollera rådgivarens kontaktkort. Originalavsändaren används aldrig som ersättning.");
        conversationId = match.id;
      } else if (fresh.lastOtherAt && task.result.acceptedAt && Date.parse(fresh.lastOtherAt) > Date.parse(String(task.result.acceptedAt))) throw new Error("Ett nytt meddelande har kommit. Läs det innan du följer upp.");
      // New message-backed task, never reset a previously executed action for resend.
      const { data: last, error } = await db.from("messages").select("id").eq("owner_id", owner).eq("conversation_id", conversationId).eq("direction", "out").order("sent_at", { ascending: false }).limit(1).maybeSingle();
      if (error || !last) throw new Error("Synkronisera skickade meddelanden innan en ny uppföljning skapas.");
      const e = await readEvidence(db, owner, last.id);
      const { data, error: save } = await db.from("assistant_tasks").upsert({ owner_id: owner, message_id: e.messageId, kind: "follow_up", plan: makePlan({ ...e, recipient: task.plan.recipient, personId: task.plan.recipientPersonId, personName: task.plan.recipientName }, "follow_up") }, { onConflict: "owner_id,message_id,kind", ignoreDuplicates: true }).select("*").maybeSingle();
      if (save) throw new Error("Uppföljningen kunde inte sparas.");
      return json({ task: data, duplicate: !data });
    }
    if (a.action === "save" || a.action === "generate") {
      if (!["decision", "ready"].includes(task.status)) throw new Error("Detta uppdrag kan inte längre ändras.");
      let plan = { ...task.plan, evidence: fresh };
      if (a.action === "generate") {
        if (task.kind === "forward") throw new Error("Redigera introduktionen till rådgivaren; ett svar till avsändaren ska inte användas som vidarebefordran.");
        const draft = await generateDraft(db, owner, plan, task.kind === "follow_up");
        await persistDraftAnalysis(db, owner, task.message_id, draft, "Natural");
        plan = { ...plan, draft, originalDraft: draft };
        return json({ task: await changeTask(db, owner, task, "decision", plan) });
      }
      if (a.edit.followUpAt && Date.parse(a.edit.followUpAt) <= Date.now()) throw new Error("Välj en framtida tid för uppföljning.");
      await persistDraftAnalysis(db, owner, task.message_id, a.edit.draft, "Owner edited");
      plan = { ...plan, draft: a.edit.draft, followUpAt: a.edit.followUpAt };
      if (task.kind === "forward") {
        if (!a.edit.recipientPersonId) throw new Error("Välj rådgivaren från Contacts.");
        plan = { ...plan, recipientPersonId: a.edit.recipientPersonId, ...await verifiedRecipient(db, owner, a.edit.recipientPersonId) };
      } else if (task.kind !== "follow_up") plan = { ...plan, recipient: fresh.recipient, recipientName: fresh.personName, recipientPersonId: fresh.personId };
      return json({ task: await changeTask(db, owner, task, sendCapability(plan, task.kind) ? "decision" : "ready", plan) });
    }
    if (a.action === "execute") {
      if (process.env.ASSISTANT_EXECUTION_ENABLED !== "true") throw new Error("Externa utskick är avstängda. Lokal verifiering skickar ingenting.");
      let replyMessageId = task.message_id;
      const completed = await executeApprovedTask(task, a.revision, a.approved, {
        verify: async plan => {
          if (plan.evidence.version !== fresh.version) throw new Error("Konversationen har ändrats. Granska och spara ett nytt förslag först.");
          if (task.kind === "follow_up" && fresh.direction === "out" && fresh.provider === "microsoft-graph") {
            if (fresh.lastUserAt && Date.parse(fresh.lastUserAt) > Date.parse(fresh.sentAt)) throw new Error("Ett nyare utskick finns. Granska det först.");
            if (!plan.recipientPersonId || plan.recipientPersonId !== fresh.personId) throw new Error("Rådgivarens identitet kunde inte verifieras.");
            const recipient = await verifiedRecipient(db, owner, plan.recipientPersonId);
            if (recipient.recipient !== plan.recipient) throw new Error("Rådgivarens adress har ändrats. Granska på nytt.");
          } else if (task.kind === "follow_up") {
            if (fresh.direction === "out" && fresh.lastUserAt && Date.parse(fresh.lastUserAt) > Date.parse(fresh.sentAt)) throw new Error("Ett nyare utskick finns redan. Synkronisera och granska det först.");
            const { data: original, error } = await db.from("messages").select("id").eq("owner_id", owner).eq("conversation_id", fresh.conversationId).eq("direction", "in").order("sent_at", { ascending: false }).limit(1).maybeSingle();
            if (error || !original) throw new Error("Ett inkommande original behövs för att följa upp i samma tråd.");
            const target = await readEvidence(db, owner, original.id);
            if (target.recipient !== plan.recipient || target.connectionId !== fresh.connectionId) throw new Error("Mottagaren eller kontot har ändrats. Granska uppföljningen igen.");
            replyMessageId = original.id;
          } else if (fresh.lastUserAt && Date.parse(fresh.lastUserAt) >= Date.parse(fresh.sentAt)) throw new Error("Du har redan svarat i konversationen.");
          if (fresh.lastOtherAt && Date.parse(fresh.lastOtherAt) > Date.parse(fresh.sentAt)) throw new Error("Ett nyare meddelande finns. Läs det först.");
          const { data: connection, error } = await db.from("connections").select("id").eq("owner_id", owner).eq("id", fresh.connectionId!).eq("provider", fresh.provider).eq("status", "connected").maybeSingle();
          if (error || !connection) throw new Error("Ursprungskontot är inte längre anslutet.");
          if (task.kind === "forward") {
            const recipient = await verifiedRecipient(db, owner, plan.recipientPersonId!);
            if (recipient.recipient !== plan.recipient) throw new Error("Rådgivarens adress har ändrats. Granska mottagaren igen.");
          }
        },
        claim: () => changeTask(db, owner, task, "executing"),
        send: async claimed => {
          const p = claimed.plan, e = p.evidence;
          if (task.kind === "follow_up" && e.direction === "out" && e.provider === "microsoft-graph") return sendOutlookFollowUp(db, owner, p, request.nextUrl.origin);
          if (e.provider === "gmail") return sendApprovedGmailReply(db, owner, p, replyMessageId, request.nextUrl.origin);
          const handler = task.kind === "forward" ? outlookForward : e.provider === "instagram-professional" ? instagramReply : e.provider === "whatsapp-business" ? whatsappReply : outlookReply;
          const body = task.kind === "forward" ? { messageId: e.messageId, conversationId: e.conversationId, recipientPersonId: p.recipientPersonId, comment: p.draft } : { messageId: replyMessageId, conversationId: e.conversationId, body: p.draft, suggestedDraft: p.originalDraft };
          const response = await handler(new NextRequest(request.url, { method: "POST", headers: { origin: request.nextUrl.origin, "content-type": "application/json" }, body: JSON.stringify({ ...body, expectedRecipient: p.recipient, expectedConnectionId: e.connectionId }) }));
          const result = await response.json();
          if (!response.ok || result.success !== true) throw new Error("Provider result requires review");
          return result;
        },
        finish: (claimed, status, result) => changeTask(db, owner, claimed, status, claimed.plan, result),
      });
      return json({ task: completed });
    }
    return json({ error: "Okänd åtgärd." }, 400);
  } catch (e) { return json({ error: e instanceof Error ? e.message : "Åtgärden kunde inte slutföras." }, 409); }
}
