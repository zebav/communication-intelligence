"use client";
import { useCallback, useEffect, useState } from "react";
import { decisionCard, kinds, kindLabels, sendCapability, statusLabels, taskBucket, type Task, type Plan, type TaskKind } from "@/lib/assistant/model";
import { AssistantBrowserStatus } from "./assistant-browser-status";
import type { BrowserReadiness } from "@/lib/assistant/browser-readiness";
import { AssistantMeeting } from "./assistant-meeting";
import { PriorityFeedback } from "./priority-feedback";
import { PersonLink } from "./person-link";
import type { CommunicationPersonOption } from "@/lib/domain";
import "./assistant-workspace.css";

export type AssistantSnapshot = {
  tasks: Task[]; candidates: { messageId: string; kind: TaskKind; plan: Plan }[];
  reviewMessages: { id: string; title: string; person: string }[];
  next: string | null; scanned: number; scannedBySource?: { email: number; messaging: number }; emailWindowDays?: number; tasksLimited: boolean;
  feedback: { category: string }[]; timezone: string | null; executionEnabled: boolean;
  browserReadiness?: BrowserReadiness;
};
type Api = (body: Record<string, unknown>) => Promise<void>;
export function AssistantWorkspace({ people }: { people: CommunicationPersonOption[] }) {
  const [snapshot, setSnapshot] = useState<AssistantSnapshot | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState("0"), [selected, setSelected] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    const timeout = AbortSignal.timeout(15_000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const r = await fetch(`/api/assistant?cursor=${cursor}`, { cache: "no-store", signal: combined });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Uppdragen kunde inte hämtas.");
    return data as AssistantSnapshot;
  }, [cursor]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal).then(data => { if (!controller.signal.aborted) { setSnapshot(data); setError(""); } }).catch(e => { if (e.name !== "AbortError") setError(e.name === "TimeoutError" ? "Handlingsinkorgen tog för lång tid att hämta. Försök igen." : e.message); }); return () => controller.abort(); }, [load]);
  const refresh = async () => { setSnapshot(await load()); };
  const act: Api = async body => {
    setBusy(true); setError("");
    const previous = snapshot;
    const action = typeof body.action === "string" ? body.action : "";
    const optimistic = action === "dismiss" || action === "dismiss_candidate";
    if (optimistic) {
      setSnapshot((current) => {
        if (!current) return current;
        if (action === "dismiss" && typeof body.id === "string") {
          return { ...current, tasks: current.tasks.filter((task) => task.id !== body.id) };
        }
        if (action === "dismiss_candidate" && typeof body.messageId === "string" && typeof body.kind === "string") {
          return { ...current, candidates: current.candidates.filter((candidate) => !(candidate.messageId === body.messageId && candidate.kind === body.kind)) };
        }
        return current;
      });
      if (action === "dismiss" && body.id === selected) setSelected("");
    }
    try {
      const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Åtgärden misslyckades.");
      if (data.task?.id && !optimistic) setSelected(data.task.id);
      // Keep the optimistic removal visible. A server reload here could briefly
      // reinsert a just-dismissed candidate from a stale read replica.
      if (!optimistic) await refresh();
    } catch (e) {
      if (optimistic && previous) setSnapshot(previous);
      else await refresh().catch(() => undefined);
      setError(e instanceof Error ? e.message : "Åtgärden misslyckades.");
    } finally { setBusy(false); }
  };
  return <div className="page assistant-workspace"><header className="assistant-header"><div><p className="eyebrow">Beslut och utförande</p><h1>Handlingsinkorg</h1><p>Välj bara vad du vill hantera. Du får sedan ett tydligt förslag att godkänna.</p></div><button className="btn" disabled={busy} onClick={() => { setError(""); void refresh().catch(e => setError(e.message)); }}>Uppdatera</button></header>
    {error && <p role="alert" className="assistant-alert">{error}</p>}
    {!snapshot ? <p role="status">{error ? "Senast sparade uppdrag visas när anslutningen är återställd." : "Hämtar uppdrag…"}</p> : <AssistantBoard snapshot={snapshot} people={people} selected={selected} onSelect={setSelected} act={act} busy={busy} onMore={() => setCursor(snapshot.next ?? "0")} onRefresh={refresh} />}
  </div>;
}
export function AssistantBoard({ snapshot, people, selected, onSelect, act, busy, onMore, onRefresh }: {
  snapshot: AssistantSnapshot; people: CommunicationPersonOption[]; selected: string; onSelect: (id: string) => void;
  act: Api; busy: boolean; onMore: () => void; onRefresh: () => Promise<void>;
}) {
  const [bucket, setBucket] = useState<"decision" | "ready" | "waiting" | "done">("decision"), [query, setQuery] = useState("");
  const [manualMessage, setManualMessage] = useState(""), [manualKind, setManualKind] = useState<TaskKind>("reply");
  const [hiddenCandidates, setHiddenCandidates] = useState<Set<string>>(() => new Set());
  const candidateKey = (messageId: string, kind: TaskKind) => `${messageId}:${kind}`;
  const visibleCandidates = snapshot.candidates.filter((candidate) => !hiddenCandidates.has(candidateKey(candidate.messageId, candidate.kind)));
  const visible = snapshot.tasks.filter(t => taskBucket(t) === bucket && `${t.plan.evidence.personName} ${t.plan.evidence.title} ${t.plan.evidence.account}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const task = snapshot.tasks.find(t => t.id === selected);
  return <>
    {!snapshot.executionEnabled && <p className="assistant-notice">Säkert förberedelseläge: nya direktutskick från handlingsinkorgen är avstängda. Kalenderflödet har sina egna separata godkännanden.</p>}
    <nav className="assistant-tabs" aria-label="Uppdragsstatus">{(["decision", "ready", "waiting", "done"] as const).map(b => <button className={`btn ${bucket === b ? "primary" : ""}`} key={b} aria-pressed={bucket === b} onClick={() => setBucket(b)}>{statusLabels[b]} <span>{snapshot.tasks.filter(t => taskBucket(t) === b).length}</span></button>)}</nav>
    <label className="assistant-search">Sök person, ärende eller konto<input value={query} onChange={e => setQuery(e.target.value)} /></label>
    {snapshot.tasksLimited && <p role="status">De 500 senast uppdaterade uppdragen visas. Detta är inte hela historiken.</p>}
    <div className="assistant-layout"><section aria-label="Uppdrag" className="assistant-list">
      {visible.length === 0 && <p className="empty-card">Inga sparade uppdrag i denna vy. Granska förslagen nedan eller lägg till ett missat uppdrag.</p>}
      {visible.map(t => <button key={t.id} className={`assistant-task ${t.id === selected ? "selected" : ""}`} onClick={() => onSelect(t.id)}><span>{kindLabels[t.kind]} · {statusLabels[t.status]}</span><strong>{t.plan.evidence.title || "Konversation"}</strong><span>{t.plan.evidence.personName}</span><small>{t.plan.evidence.source} · {t.plan.evidence.account} · Prioritet {t.plan.evidence.priority.toFixed(1)}/10{t.plan.evidence.unread ? " · Oläst" : ""}</small>{t.plan.followUpAt && <small>Följ upp {new Date(t.plan.followUpAt).toLocaleString("sv-SE")}</small>}</button>)}
    </section><section className="assistant-detail" aria-label="Granska uppdrag">{task ? <TaskDetail key={`${task.id}:${task.revision}`} task={task} people={people} busy={busy} act={act} snapshot={snapshot} onRefresh={onRefresh} /> : <div className="empty-card"><h2>Välj ett uppdrag</h2><p>Här visas original, föreslagna steg, mottagare och ditt redigerbara svar.</p></div>}</section></div>
    <section className="assistant-proposals"><h2>Nya beslut från konversationer</h2><p>Senaste hämtningen granskade {snapshot.scanned} inkommande meddelanden{snapshot.scannedBySource ? `: ${snapshot.scannedBySource.email} relevanssorterade e-post från de senaste ${snapshot.emailWindowDays ?? 7} dagarna och ${snapshot.scannedBySource.messaging} från andra kanaler` : ""}. Reklam och redan besvarade meddelanden föreslås inte. Förslagen är inte godkännanden.</p>
      <div className="assistant-proposal-grid">{visibleCandidates.map(candidate => {
        const card = decisionCard(candidate.plan, candidate.kind);
        const evidence = candidate.plan.evidence;
        const key = candidateKey(candidate.messageId, candidate.kind);
        return <article className="assistant-task assistant-proposal-card" key={key}>
          <div className="assistant-proposal-person"><strong>{evidence.personName}</strong><span>{evidence.source} · {evidence.account}</span></div>
          <small>{kindLabels[candidate.kind]} · Prioritet {evidence.priority.toFixed(1)}/10{evidence.unread ? " · Oläst" : ""}</small>
          <h3>{evidence.title || "Konversation"}</h3>
          <p className="assistant-proposal-summary">{card.summary}</p>
          <div className="assistant-proposal-action"><span>Föreslaget</span><p>{card.proposedAction}</p></div>
          <div className="assistant-buttons"><button className="btn primary" disabled={busy} onClick={() => act({ action: "start", messageId: candidate.messageId, kind: candidate.kind })}>Förbered uppdrag</button><button className="btn" disabled={busy} onClick={() => { setHiddenCandidates((current) => new Set(current).add(key)); void act({ action: "dismiss_candidate", messageId: candidate.messageId, kind: candidate.kind }); }}>Inte relevant</button></div>
        </article>;
      })}</div>
      {snapshot.next && <button className="btn" disabled={busy} onClick={onMore}>Granska nästa 100 äldre meddelanden</button>}
      <details><summary>AI missade ett uppdrag</summary><label>Välj meddelande från hämtat underlag<select value={manualMessage} onChange={e => setManualMessage(e.target.value)}><option value="">Välj meddelande</option>{snapshot.reviewMessages.map(m => <option key={m.id} value={m.id}>{m.person} · {m.title}</option>)}</select></label><label>Vad behöver göras?<select value={manualKind} onChange={e => setManualKind(e.target.value as TaskKind)}>{kinds.map(k => <option key={k} value={k}>{kindLabels[k]}</option>)}</select></label><button className="btn" disabled={busy || !manualMessage} onClick={() => act({ action: "start", messageId: manualMessage, kind: manualKind })}>Skapa för granskning</button></details>
    </section>
    <div className="assistant-notice"><strong>Lärande är separerat från besluten.</strong><p>Regler, svarston, irrelevanta avsändare och bekräftad kontaktkontext granskas under Settings → Learning & Memory. Handlingsinkorgen visar bara det du behöver besluta om nu.</p></div>
  </>;
}
function TaskDetail({ task, people, busy, act, snapshot, onRefresh }: { task: Task; people: CommunicationPersonOption[]; busy: boolean; act: Api; snapshot: AssistantSnapshot; onRefresh: () => Promise<void> }) {
  const p = task.plan, e = p.evidence, decision = decisionCard(p, task.kind);
  const [draft, setDraft] = useState(p.draft), [person, setPerson] = useState(p.recipientPersonId ?? ""), [search, setSearch] = useState("");
  const [followAt, setFollowAt] = useState(p.followUpAt ? new Date(Date.parse(p.followUpAt) - new Date(p.followUpAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
  const [approved, setApproved] = useState(false), [note, setNote] = useState(""), [feedback, setFeedback] = useState("useful"), [meeting, setMeeting] = useState(false), [copied, setCopied] = useState(false);
  const editable = ["decision", "ready"].includes(task.status);
  const editedFollow = followAt ? new Date(followAt).toISOString() : null;
  const dirty = draft !== p.draft || person !== (p.recipientPersonId ?? "") || editedFollow !== p.followUpAt;
  const capability = sendCapability(p, task.kind);
  const run = (action: string, extra: Record<string, unknown> = {}) => act({ action, id: task.id, revision: task.revision, ...extra });
  return <>
    <p className="eyebrow">{kindLabels[task.kind]} · {statusLabels[task.status]}</p><h2>{e.title}</h2>
    <PersonLink personId={e.personId ?? undefined} name={e.personName} /><p>{e.source} · {e.account}</p>
    <section className="decision-card" aria-label="Beslutsunderlag">
      <div className="decision-card-section"><span>Sammanfattning</span><p>{decision.summary}</p></div>
      <div className="decision-card-section"><span>Varför detta är viktigt</span><p>{decision.whyImportant}</p></div>
      <div className="decision-card-section"><span>Föreslagen åtgärd</span><p>{decision.proposedAction}</p>{decision.targetUrl && <a href={decision.targetUrl} target="_blank" rel="noreferrer">{decision.targetUrl}</a>}</div>
      <div className="decision-card-section approval-outcome"><span>Detta händer när du godkänner</span><p>{decision.approvalOutcome}</p></div>
    </section>
    {["instagram", "whatsapp"].includes(e.source) ? <section className="assistant-original-card assistant-original-visible" aria-label="Hela meddelandet"><h3>Hela meddelandet från {e.personName}</h3><p className="assistant-original">{e.body || "Originaltexten saknas i den synkroniserade posten."}</p></section> : <details className="assistant-source-details"><summary>Visa original och underlag</summary><section className="assistant-original-card" aria-label="Kontaktens originalmeddelande"><h3>Kontaktens originalmeddelande</h3><p className="assistant-original">{e.body || "Originaltexten saknas i den synkroniserade posten."}</p></section><ol className="assistant-steps">{p.steps.map(s => <li key={s}>{s}</li>)}</ol></details>}
    {task.kind === "meeting" && <section className="assistant-prepared-meeting"><h3>Förberett mötesunderlag</h3>{p.preparation?.meeting ? <><p>{p.preparation.summary}</p>{p.preparation.meeting.placeName && <p><strong>Plats:</strong> {p.preparation.meeting.placeName} · {p.preparation.meeting.placeAddress}</p>}{p.preparation.meeting.travelSummary && <p><strong>Restid:</strong> {p.preparation.meeting.travelSummary}</p>}<div className="assistant-buttons">{p.preparation.meeting.slots.map((slot) => <span className="pill" key={slot.start}>{new Intl.DateTimeFormat("sv-SE", { timeZone: snapshot.timezone ?? "Europe/Stockholm", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(slot.start))}</span>)}</div>{p.preparation.status !== "ready" && <p className="assistant-notice">Planeringen behöver mer information innan ett säkert tidsförslag kan skickas.</p>}</> : <p className="assistant-notice">Mötesplaneringen är inte förberedd ännu.</p>}{editable && <details><summary>Ändra eller planera manuellt</summary><button className="btn" onClick={() => setMeeting(v => !v)}>Öppna masterkalenderns planering</button>{meeting && (snapshot.timezone ? <AssistantMeeting timezone={snapshot.timezone} plan={p} onDone={() => run("reconcile")} /> : <p role="alert">Masterkalenderns tidszon kunde inte läsas. Anslut kalendern innan bokning.</p>)}</details>}</section>}
    {task.kind === "website" && <>
      {p.preparation?.research && <section className="assistant-prepared-research"><h3>AI research klar</h3><p>{p.preparation.research.overview}</p><p><strong>Rekommenderad väg:</strong> {p.preparation.research.recommendedApproach}</p>{p.preparation.research.sources.length > 0 && <div className="assistant-research-sources">{p.preparation.research.sources.map((source) => { let label = source.title; try { const url = new URL(source.url); label = source.title || url.hostname; } catch {} return <a href={source.url} title={source.url} target="_blank" rel="noreferrer" key={source.url}>{label}</a>; })}</div>}</section>}
      {p.draft && <section className="assistant-prepared-reply"><h3>Färdigt svarsförslag efter research</h3><textarea rows={8} readOnly value={p.draft} aria-label="Färdigt svarsförslag efter research" /><button className="btn" onClick={() => { void navigator.clipboard.writeText(p.draft).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? "Kopierat – inget har skickats" : "Kopiera svarsförslag"}</button></section>}
      <AssistantBrowserStatus task={task} readiness={snapshot.browserReadiness} onRefresh={onRefresh} />
    </>}
    {task.kind !== "website" && <>
      {task.kind === "forward" && editable && <fieldset disabled={busy}><legend>Välj rådgivare från Contacts</legend><label>Sök namn, roll, organisation eller land<input value={search} onChange={v => { setSearch(v.target.value); setApproved(false); }} /></label><select aria-label="Rådgivare" value={person} onChange={v => { setPerson(v.target.value); setApproved(false); }}><option value="">Välj mottagare</option>{people.filter(c => c.id === person || `${c.name} ${c.organization} ${c.relationship} ${c.professionalSpecialty} ${c.jurisdiction}`.toLowerCase().includes(search.toLowerCase())).slice(0, 100).map(c => <option key={c.id} value={c.id}>{c.name} · {c.professionalSpecialty || c.relationship} · {c.jurisdiction}</option>)}</select><p>Adressen verifieras när du sparar. Originalmeddelandet följer med; granska även dess känsliga innehåll och bilagor.</p></fieldset>}
      <label>Förslag på {task.kind === "forward" ? "introduktion" : "svar"}<textarea rows={9} maxLength={4000} value={draft} readOnly={!editable} onChange={v => { setDraft(v.target.value); setApproved(false); }} /></label>
      <p>Mottagare: <strong>{p.recipientName || "Inte vald"}</strong> · {p.recipient || "Ingen verifierad adress"}</p>
      <label>Påminn om svar saknas (din lokala tidszon)<input type="datetime-local" value={followAt} disabled={!editable} onChange={v => { setFollowAt(v.target.value); setApproved(false); }} /></label>
      {editable && <div className="assistant-buttons">{task.kind !== "forward" && <button className="btn" disabled={busy || dirty} onClick={() => run("generate")}>Generera om svar med min profil och historik</button>}<button className="btn primary" disabled={busy} onClick={() => run("save", { edit: { draft, recipientPersonId: person || null, followUpAt: editedFollow } })}>Spara för granskning</button></div>}
      {capability && <p className="assistant-notice">{capability}</p>}
      <button className="btn" disabled={!draft} onClick={() => { void navigator.clipboard.writeText(draft).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? "Kopierat – inget har skickats" : "Kopiera svar"}</button>
      {task.status === "ready" && !capability && <section className="assistant-approval"><h3>Godkänn exakt plan</h3><p>{decision.approvalOutcome}</p><p>Från {e.account} till {p.recipientName} ({p.recipient}). {task.kind === "forward" ? "Originalmejlet vidarebefordras tillsammans med introduktionen." : task.kind === "follow_up" && e.direction === "out" && e.provider === "microsoft-graph" ? `Ett nytt mejl skickas med ämnet ”Uppföljning: ${e.title}”. Inga bilagor skickas. Det kan visas som en separat tråd i Outlook.` : "Den sparade texten skickas i samma konversation."}</p><label><input type="checkbox" checked={approved} disabled={dirty || busy} onChange={v => setApproved(v.target.checked)} /> Jag godkänner denna mottagare och exakt den sparade texten.</label><button className="btn primary" disabled={!approved || dirty || busy || !snapshot.executionEnabled} onClick={() => run("execute", { approved: true })}>Godkänn och skicka en gång</button>{dirty && <p>Spara ändringarna och granska igen.</p>}</section>}
    </>}
    {(task.status === "executing" || task.status === "uncertain") && <p className="assistant-alert">Resultatet måste kontrolleras hos leverantören. Automatisk omsändning är spärrad. Markera som hanterat först när du vet vad som hände.</p>}
    {task.status === "waiting" && task.kind !== "website" && <><p>{task.observedReplyAt ? "Ett nytt meddelande har kommit i konversationen. Granska det innan någon uppföljning skickas." : "Leverantören tog emot åtgärden. Detta bekräftar inte att mottagaren har läst eller svarat."}</p><button className="btn" disabled={busy || Boolean(task.observedReplyAt)} onClick={() => run("follow_up")}>Förbered separat uppföljning</button>{task.kind === "forward" && <p>En uppföljning skapas endast om en entydig obesvarad tråd med rådgivaren hittas för samma ärende och konto.</p>}</>}
    <details><summary>Avsluta eller lämna feedback</summary><label>Din bedömning<textarea maxLength={1000} value={note} onChange={v => setNote(v.target.value)} /></label><label>Kvalitetsomdöme<select value={feedback} onChange={v => setFeedback(v.target.value)}><option value="useful">Användbart</option><option value="wrong_recipient">Fel mottagare</option><option value="not_relevant">Inte relevant</option><option value="missed_task">Missat uppdrag</option><option value="draft_edited">Utkastet behövde ändras</option></select></label><button className="btn" disabled={busy || note.trim().length < 3} onClick={() => run("feedback", { category: feedback, note })}>Spara omdöme</button>
      {!["done", "dismissed"].includes(task.status) && <button className="btn" disabled={busy || note.trim().length < 5} onClick={() => run("complete", { note })}>Jag bekräftar att uppdraget är hanterat</button>}
      {["decision", "ready", "waiting"].includes(task.status) && <button className="btn" disabled={busy} onClick={() => run("dismiss")}>Avstå från uppdraget</button>}
    </details><PriorityFeedback messageId={e.messageId} initialScore={e.priority || 5} />
  </>;
}
