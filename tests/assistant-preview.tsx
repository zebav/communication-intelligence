import React from "react";
import { createRoot } from "react-dom/client";
import { AssistantWorkspace, type AssistantSnapshot } from "../src/components/assistant-workspace";
import { makePlan, type Evidence, type Task, type TaskKind } from "../src/lib/assistant/model";
import "../src/app/globals.css";
if (!["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) throw new Error("Local synthetic preview only");
const e: Evidence = { messageId: "test-message", conversationId: "test-conversation", personId: null, personName: "Anna · testkontakt", source: "email", connectionId: "test-account", provider: "microsoft-graph", account: "test@example.invalid", title: "Kan vi träffas nästa vecka och diskutera projektet?", body: "Hej! Har du möjlighet att ses nästa vecka? Vi kan ta en lunch och gå igenom projektplanen.\nVänliga hälsningar, Anna", sentAt: new Date().toISOString(), direction: "in", lastUserAt: null, lastOtherAt: null, classification: "Business", priority: 7, analysis: { requiresReply: true, draftResponse: "Hej Anna! Det låter trevligt. Vilken dag passar dig bäst nästa vecka?" }, recipient: "anna@example.invalid", version: "test-version" };
const tasks: Task[] = (["meeting", "forward", "reply", "follow_up"] as TaskKind[]).map((kind, i) => ({ id: `test-${i}`, message_id: `m-${i}`, kind, status: i === 2 ? "ready" : i === 3 ? "waiting" : "decision", revision: 1, plan: { ...makePlan({ ...e, title: [e.title, "Juridisk granskning av avtal", "Svar om nästa steg", "Inväntar projektunderlag"][i], personName: i === 1 ? "Johan · testkontakt" : e.personName }, kind), followUpAt: i === 3 ? "2026-01-01T00:00:00Z" : null }, result: {}, created_at: e.sentAt, updated_at: e.sentAt }));
const snapshot: AssistantSnapshot = { tasks, candidates: [{ messageId: "candidate", kind: "reply", plan: makePlan({ ...e, personName: "Sam · testkontakt", title: "En fråga som behöver svar", source: "instagram", account: "@syntetiskt_musikkonto", provider: "instagram-professional" }, "reply") }], reviewMessages: [{ id: "candidate", title: "En fråga som behöver svar", person: "Sam" }], scanned: 100, next: null, tasksLimited: false, feedback: [{ category: "useful" }], timezone: "Europe/Stockholm", executionEnabled: false };
window.fetch = async (input, init) => {
  const url = String(input);
  if (!url.startsWith("/api/")) throw new Error("External requests blocked in preview");
  if (url.startsWith("/api/assistant")) {
    if (!init?.method || init.method === "GET") return Response.json(snapshot);
    const body = JSON.parse(String(init.body)), t = tasks.find(v => v.id === body.id);
    if (body.action === "execute") return Response.json({ error: "Utskick avstängda i isolerat test." }, { status: 403 });
    if (body.action === "start") {
      const task: Task = { ...tasks[0], id: "test-new", kind: body.kind, status: "decision", revision: 1, plan: snapshot.candidates[0]?.plan ?? makePlan(e, body.kind) };
      tasks.push(task); snapshot.candidates = []; return Response.json({ task });
    }
    if (!t) return Response.json({ error: "Testuppdrag saknas" }, { status: 404 });
    if (body.action === "save") { Object.assign(t.plan, body.edit); t.status = "ready"; t.revision++; }
    if (body.action === "generate") { t.plan.draft = "Hej! Tack för ditt meddelande. Berätta gärna mer om vad du behöver, så tar vi nästa steg tillsammans."; t.status = "decision"; t.revision++; }
    if (body.action === "dismiss") { t.status = "dismissed"; t.revision++; }
    if (body.action === "complete") { t.status = "done"; t.revision++; }
    if (body.action === "feedback") snapshot.feedback.push({ category: body.category });
    return Response.json({ task: t });
  }
  if (url === "/api/priority") return Response.json({ success: true });
  if (url === "/api/calendar/planning") return Response.json({ rules: { preparationMinutes: 10, recoveryMinutes: 10 }, mapsEnabled: false });
  if (url === "/api/calendar/intents") return Response.json({ proposal: { proposal: { operation: "propose", summary: "Lunch nästa vecka. Datum behöver bestämmas.", date: null, durationMinutes: 60, questions: ["Vilken dag passar?"], evidence: [], locationText: null } } });
  return Response.json({ error: "Extern tjänst avstängd i isolerat test." }, { status: 503 });
};
createRoot(document.getElementById("root")!).render(<AssistantWorkspace people={[{ id: "advisor", name: "Eva · testadvokat", relationship: "lawyer", organization: "Syntetisk advokatbyrå", jurisdiction: "Spanien" }]} />);
