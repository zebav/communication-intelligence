"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { approvalBrief, decisionCard, kinds, kindLabels, sendCapability, statusLabels, taskBucket, type Task, type Plan, type TaskKind } from "@/lib/assistant/model";
import { AssistantBrowserStatus } from "./assistant-browser-status";
import type { BrowserReadiness } from "@/lib/assistant/browser-readiness";
import { AssistantMeeting } from "./assistant-meeting";
import { PriorityFeedback } from "./priority-feedback";
import { PersonLink } from "./person-link";
import type { CommunicationPersonOption } from "@/lib/domain";
import { mediaDecisionLabel } from "@/lib/media/decision-gate";
import { MessageAttachments } from "./message-attachments";
import { ScheduledSendControl } from "./scheduled-send-control";
import "./assistant-workspace.css";

export type AssistantSnapshot = {
  tasks: Task[]; candidates: { messageId: string; kind: TaskKind; plan: Plan }[];
  notes?: { messageId: string; title: string; personName: string; source: string; account: string; priority: number; unread?: boolean; summary: string }[];
  reviewMessages: { id: string; title: string; person: string }[];
  next: string | null; scanned: number; scannedBySource?: { email: number; messaging: number }; emailWindowDays?: number; tasksLimited: boolean;
  feedback: { category: string }[]; timezone: string | null; executionEnabled: boolean;
  browserReadiness?: BrowserReadiness;
  operations?: { pendingMedia: number; failedMedia: number; actionRequiredConnections: number; awaitingAnalysis: number; learningSuggestions: number };
};
type Api = (body: Record<string, unknown>) => Promise<void>;
export function AssistantWorkspace({ people }: { people: CommunicationPersonOption[] }) {
  const [snapshot, setSnapshot] = useState<AssistantSnapshot | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState("0"), [selected, setSelected] = useState("");
  const maintenanceRefreshScheduled = useRef(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    const timeout = AbortSignal.timeout(15_000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const r = await fetch(`/api/assistant?cursor=${cursor}`, { cache: "no-store", signal: combined });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Uppdragen kunde inte hämtas.");
    return data as AssistantSnapshot;
  }, [cursor]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal).then(data => { if (!controller.signal.aborted) { setSnapshot(data); setError(""); } }).catch(e => { if (e.name !== "AbortError") setError(e.name === "TimeoutError" ? "Notiscentret tog för lång tid att hämta. Försök igen." : e.message); }); return () => controller.abort(); }, [load]);
  // The workspace starts maintenance just after login. Refresh once after its
  // bounded first pass so new decisions appear without the user pressing a button.
  useEffect(() => {
    if (maintenanceRefreshScheduled.current) return;
    maintenanceRefreshScheduled.current = true;
    const timer = window.setTimeout(() => {
      void load().then((data) => { setSnapshot(data); setError(""); }).catch(() => undefined);
    }, 9_000);
    return () => window.clearTimeout(timer);
  }, [load]);
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
  return <div className="page assistant-workspace"><header className="assistant-header"><div><p className="eyebrow">Dina beslut</p><h1>Notiscenter</h1><p>Här visas bara sådant som behöver ditt beslut. Godkänn, neka eller be systemet förbereda nästa steg.</p></div><button className="btn" disabled={busy} onClick={() => { setError(""); void refresh().catch(e => setError(e.message)); }}>Uppdatera</button></header>
    {error && <p role="alert" className="assistant-alert">{error}</p>}
    {!snapshot ? <p role="status">{error ? "Senast sparade uppdrag visas när anslutningen är återställd." : "Hämtar uppdrag…"}</p> : <AssistantBoard snapshot={snapshot} people={people} selected={selected} onSelect={setSelected} act={act} busy={busy} onMore={() => setCursor(snapshot.next ?? "0")} onRefresh={refresh} />}
  </div>;
}
export function AssistantBoard({ snapshot, people, selected, onSelect, act, busy, onMore, onRefresh }: {
  snapshot: AssistantSnapshot; people: CommunicationPersonOption[]; selected: string; onSelect: (id: string) => void;
  act: Api; busy: boolean; onMore: () => void; onRefresh: () => Promise<void>;
}) {
  const [bucket, setBucket] = useState<"decision" | "ready" | "waiting" | "done">("decision"), [mode, setMode] = useState<"handle" | "note">("handle"), [query, setQuery] = useState("");
  const [manualMessage, setManualMessage] = useState(""), [manualKind, setManualKind] = useState<TaskKind>("reply");
  const [hiddenCandidates, setHiddenCandidates] = useState<Set<string>>(() => new Set()), [hiddenNotes, setHiddenNotes] = useState<Set<string>>(() => new Set()), [showAllCandidates, setShowAllCandidates] = useState(false);
  const candidateKey = (messageId: string, kind: TaskKind) => `${messageId}:${kind}`;
  const visibleCandidates = snapshot.candidates.filter((candidate) => !hiddenCandidates.has(candidateKey(candidate.messageId, candidate.kind)));
  const displayedCandidates = showAllCandidates ? visibleCandidates : visibleCandidates.slice(0, 6);
  const visible = snapshot.tasks.filter(t => taskBucket(t) === bucket && `${t.plan.evidence.personName} ${t.plan.evidence.title} ${t.plan.evidence.account}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const task = snapshot.tasks.find(t => t.id === selected);
  const operations = snapshot.operations;
  const actionRequired = operations?.actionRequiredConnections ?? 0;
  return <>
    {!snapshot.executionEnabled && <p className="assistant-notice">Säkert förberedelseläge: systemet kan förbereda förslag men skickar eller bokar inget härifrån utan ett separat godkännande.</p>}
    {operations && actionRequired > 0 && <section className="assistant-operations needs-attention" aria-label="Anslutning behöver återanslutas"><div><p className="eyebrow">Anslutning behöver återanslutas</p><h2>En tjänst behöver din inloggning</h2><p>{actionRequired} anslutning{actionRequired === 1 ? " behöver" : "ar behöver"} loggas in igen. Övrig synkning, medieanalys och återförsök fortsätter automatiskt i bakgrunden.</p></div><div className="assistant-operation-stats"><span><strong>{operations.learningSuggestions}</strong> lärandeförslag</span><span><strong>{snapshot.candidates.length}</strong> nya beslut</span><span><strong>{snapshot.notes?.length ?? 0}</strong> att notera</span></div></section>}
    <nav className="assistant-tabs" aria-label="Notisvyer"><button className={`btn ${mode === "handle" ? "primary" : ""}`} aria-pressed={mode === "handle"} onClick={() => setMode("handle")}>Bör hanteras <span>{snapshot.candidates.length + snapshot.tasks.filter(t => ["decision", "ready"].includes(taskBucket(t))).length}</span></button><button className={`btn ${mode === "note" ? "primary" : ""}`} aria-pressed={mode === "note"} onClick={() => setMode("note")}>Bör noteras <span>{snapshot.notes?.length ?? 0}</span></button></nav>
    {mode === "handle" && <><nav className="assistant-tabs assistant-status-tabs" aria-label="Uppdragsstatus">{(["decision", "ready", "waiting", "done"] as const).map(b => <button className={`btn ${bucket === b ? "primary" : ""}`} key={b} aria-pressed={bucket === b} onClick={() => setBucket(b)}>{statusLabels[b]} <span>{snapshot.tasks.filter(t => taskBucket(t) === b).length}</span></button>)}</nav>
    <label className="assistant-search">Sök person, ärende eller konto<input value={query} onChange={e => setQuery(e.target.value)} /></label>
    {snapshot.tasksLimited && <p role="status">De 120 senast uppdaterade uppdragen visas. Detta är inte hela historiken.</p>}
    <div className="assistant-layout"><section aria-label="Uppdrag" className="assistant-list">
      {visible.length === 0 && <p className="empty-card">Inga sparade uppdrag i denna vy. Granska förslagen nedan eller lägg till ett missat uppdrag.</p>}
      {visible.map(t => <button key={t.id} className={`assistant-task ${t.id === selected ? "selected" : ""}`} onClick={() => onSelect(t.id)}><span>{kindLabels[t.kind]} · {statusLabels[t.status]}</span><strong>{t.plan.evidence.title || "Konversation"}</strong><span>{t.plan.evidence.personName}</span><small>{t.plan.evidence.source} · {t.plan.evidence.account} · Prioritet {t.plan.evidence.priority.toFixed(1)}/10{t.plan.evidence.unread ? " · Oläst" : ""}</small>{t.plan.evidence.mediaState && t.plan.evidence.mediaState !== "not_applicable" && <small>{mediaDecisionLabel(t.plan.evidence.mediaState)}</small>}{t.plan.followUpAt && <small>Följ upp {new Date(t.plan.followUpAt).toLocaleString("sv-SE")}</small>}</button>)}
    </section><section className="assistant-detail" aria-label="Granska uppdrag">{task ? <TaskDetail key={`${task.id}:${task.revision}`} task={task} people={people} busy={busy} act={act} snapshot={snapshot} onRefresh={onRefresh} /> : <div className="empty-card"><h2>Välj ett uppdrag</h2><p>Här visas original, föreslagna steg, mottagare och ditt redigerbara svar.</p></div>}</section></div>
    <section className="assistant-proposals"><h2>Nya notiser</h2><p>Systemet har granskat {snapshot.scanned} inkommande meddelanden{snapshot.scannedBySource ? `: ${snapshot.scannedBySource.email} relevanssorterade e-post från de senaste ${snapshot.emailWindowDays ?? 7} dagarna och ${snapshot.scannedBySource.messaging} från andra kanaler` : ""}. Reklam och redan besvarade meddelanden hålls utanför.</p>
      <div className="assistant-proposal-grid">{displayedCandidates.map(candidate => {
        const card = decisionCard(candidate.plan, candidate.kind);
        const evidence = candidate.plan.evidence;
        const key = candidateKey(candidate.messageId, candidate.kind);
        return <article className="assistant-task assistant-proposal-card" key={key}>
          <div className="assistant-proposal-person"><strong>{evidence.personName}</strong><span>{evidence.source} · {evidence.account}</span></div>
          <small>{kindLabels[candidate.kind]} · Prioritet {evidence.priority.toFixed(1)}/10{evidence.unread ? " · Oläst" : ""}</small>
          <h3>{evidence.title || "Konversation"}</h3>
          <p className="assistant-proposal-summary">{card.summary}</p>
          <div className="assistant-proposal-action"><span>Föreslaget</span><p>{card.proposedAction}</p></div>
          <div className="assistant-buttons"><button className="btn primary" disabled={busy} onClick={() => act({ action: "start", messageId: candidate.messageId, kind: candidate.kind })}>Förbered uppdrag</button><button className="btn" disabled={busy} onClick={() => { setHiddenCandidates((current) => new Set(current).add(key)); void act({ action: "dismiss_candidate", messageId: candidate.messageId, kind: candidate.kind }); }}>Inte relevant</button><button className="btn" disabled={busy} onClick={() => { setHiddenCandidates((current) => new Set(current).add(key)); void act({ action: "dismiss_candidate", messageId: candidate.messageId, kind: candidate.kind, scope: "sender" }); }}>Prioritera avsändaren lägre</button></div>
        </article>;
      })}</div>
      <div className="assistant-buttons">{visibleCandidates.length > displayedCandidates.length && <button className="btn" disabled={busy} onClick={() => setShowAllCandidates(true)}>Visa {visibleCandidates.length - displayedCandidates.length} fler förslag</button>}{snapshot.next && <button className="btn" disabled={busy} onClick={() => { setShowAllCandidates(false); onMore(); }}>Granska ytterligare meddelanden</button>}</div>
      <details><summary>AI missade ett uppdrag</summary><label>Välj meddelande från hämtat underlag<select value={manualMessage} onChange={e => setManualMessage(e.target.value)}><option value="">Välj meddelande</option>{snapshot.reviewMessages.map(m => <option key={m.id} value={m.id}>{m.person} · {m.title}</option>)}</select></label><label>Vad behöver göras?<select value={manualKind} onChange={e => setManualKind(e.target.value as TaskKind)}>{kinds.map(k => <option key={k} value={k}>{kindLabels[k]}</option>)}</select></label><button className="btn" disabled={busy || !manualMessage} onClick={() => act({ action: "start", messageId: manualMessage, kind: manualKind })}>Skapa för granskning</button></details>
    </section>
    <div className="assistant-notice"><strong>Det systemet lär sig.</strong><p>Regler, svarston, irrelevanta avsändare och bekräftad kontaktkontext samlas under Settings → Learning & Memory. Här visar vi bara beslut som kräver dig nu.</p></div></>}
    {mode === "note" && <section className="assistant-proposals" aria-label="Meddelanden att notera"><h2>Bör noteras</h2><p>Viktiga informationsmeddelanden som normalt inte kräver ett svar. De kan alltid öppnas i Inbox om du vill agera.</p><div className="assistant-proposal-grid">{(snapshot.notes ?? []).filter(note => !hiddenNotes.has(note.messageId)).map(note => <article className="assistant-task assistant-proposal-card" key={note.messageId}><div className="assistant-proposal-person"><strong>{note.personName}</strong><span>{note.source} · {note.account}</span></div><small>Prioritet {note.priority.toFixed(1)}/10{note.unread ? " · Oläst" : ""}</small><h3>{note.title || "Meddelande"}</h3><p className="assistant-proposal-summary">{note.summary}</p><div className="assistant-buttons"><button className="btn" disabled={busy} onClick={() => { setHiddenNotes(current => new Set(current).add(note.messageId)); void act({ action: "dismiss_candidate", messageId: note.messageId, kind: "reply" }); }}>Inte relevant</button><button className="btn" disabled={busy} onClick={() => { setHiddenNotes(current => new Set(current).add(note.messageId)); void act({ action: "dismiss_candidate", messageId: note.messageId, kind: "reply", scope: "sender" }); }}>Prioritera avsändaren lägre</button></div></article>)}</div>{(snapshot.notes ?? []).filter(note => !hiddenNotes.has(note.messageId)).length === 0 && <p className="empty-card">Inga viktiga informationsmeddelanden just nu.</p>}</section>}
  </>;
}
function TaskDetail({ task, people, busy, act, snapshot, onRefresh }: { task: Task; people: CommunicationPersonOption[]; busy: boolean; act: Api; snapshot: AssistantSnapshot; onRefresh: () => Promise<void> }) {
  const p = task.plan, e = p.evidence, decision = decisionCard(p, task.kind);
  const brief = approvalBrief(p, task.kind, task.status);
  const [draft, setDraft] = useState(p.draft), [person, setPerson] = useState(p.recipientPersonId ?? ""), [search, setSearch] = useState("");
  const [followAt, setFollowAt] = useState(p.followUpAt ? new Date(Date.parse(p.followUpAt) - new Date(p.followUpAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
  const [approved, setApproved] = useState(false), [note, setNote] = useState(""), [feedback, setFeedback] = useState("useful"), [meeting, setMeeting] = useState(false), [copied, setCopied] = useState(false);
  const editable = ["decision", "ready"].includes(task.status);
  const editedFollow = followAt ? new Date(followAt).toISOString() : null;
  const dirty = draft !== p.draft || person !== (p.recipientPersonId ?? "") || editedFollow !== p.followUpAt;
  const capability = sendCapability(p, task.kind);
  const hasDraft = Boolean(p.draft.trim());
  const run = (action: string, extra: Record<string, unknown> = {}) => act({ action, id: task.id, revision: task.revision, ...extra });
  return <>
    <p className="eyebrow">{kindLabels[task.kind]} · {statusLabels[task.status]}</p><h2>{e.title}</h2>
    <div className="assistant-contact-actions"><PersonLink personId={e.personId ?? undefined} name={e.personName} />{e.personId && <a className="btn" href={`/contacts/${encodeURIComponent(e.personId)}`}>Redigera kontakt</a>}</div><p>{e.source} · {e.account}</p>
    <section className={`approval-brief approval-brief-${brief.state}`} aria-label="Godkännandesteg">
      <div className="approval-brief-heading"><div><span>Approval-to-Execution</span><h3>{brief.state === "ready" ? "Redo för ditt godkännande" : brief.state === "blocked" ? "Planen är spärrad" : "Planen behöver granskas"}</h3></div><span className="approval-state">{brief.state === "ready" ? "Redo" : brief.state === "blocked" ? "Spärrad" : "Granska"}</span></div>
      <div className="approval-brief-grid"><div><span>Ärendet</span><p>{decision.summary}</p></div><div><span>Det systemet gör</span><p>{brief.action}</p></div><div><span>Mål</span><p>{brief.destination}</p></div></div>
      <p className="approval-brief-guard">{brief.guard}</p>
      <details className="decision-card-details"><summary>Visa bakgrund och full effekt av beslutet</summary><div className="decision-card"><div className="decision-card-section"><span>Varför detta är viktigt</span><p>{decision.whyImportant}</p></div><div className="decision-card-section"><span>Föreslagen åtgärd</span><p>{decision.proposedAction}</p>{decision.targetUrl && <a href={decision.targetUrl} target="_blank" rel="noreferrer">{decision.targetUrl}</a>}</div><div className="decision-card-section approval-outcome"><span>Detta händer när du godkänner</span><p>{decision.approvalOutcome}</p></div></div></details>
    </section>
    {e.mediaState && e.mediaState !== "not_applicable" && <section className="assistant-notice"><strong>Bilaga/media:</strong> {mediaDecisionLabel(e.mediaState)}{e.mediaState === "pending" || e.mediaState === "processing" ? ". Systemet håller tillbaka svar och andra externa åtgärder tills den säkra analysen är klar." : "."}{e.mediaState === "ready" && e.mediaSummaries?.length ? <details className="assistant-media-details"><summary>Vad AI hittade i bilagan</summary><ul>{e.mediaSummaries.map((summary, index) => <li key={`${index}:${summary}`}>{summary}</li>)}</ul></details> : null}<MessageAttachments messageId={e.messageId} expected={e.attachmentCount} /></section>}
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
      {editable && <div className="assistant-buttons">{task.kind !== "forward" && <button className="btn" disabled={busy || dirty} onClick={() => run("generate")}>{hasDraft ? "Generera om svar med min profil och historik" : "Skapa svarsförslag med min profil och historik"}</button>}<button className="btn primary" disabled={busy} onClick={() => run("save", { edit: { draft, recipientPersonId: person || null, followUpAt: editedFollow } })}>Spara för granskning</button></div>}
      {capability && <p className="assistant-notice">{capability}</p>}
      <button className="btn" disabled={!draft} onClick={() => { void navigator.clipboard.writeText(draft).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? "Kopierat – inget har skickats" : "Kopiera svar"}</button>
      {task.kind === "reply" && ["email", "instagram", "whatsapp"].includes(e.source) && <ScheduledSendControl conversationId={e.conversationId} messageId={e.messageId} source={e.source} body={draft} disabled={!editable || busy || dirty} onScheduled={() => void onRefresh()} />}
      {task.status === "ready" && !capability && <section className="assistant-approval"><h3>Godkänn exakt plan</h3><p>{decision.approvalOutcome}</p><p>Från {e.account} till {p.recipientName} ({p.recipient}). {task.kind === "forward" ? "Originalmejlet vidarebefordras tillsammans med introduktionen." : task.kind === "follow_up" && e.direction === "out" && e.provider === "microsoft-graph" ? `Ett nytt mejl skickas med ämnet ”Uppföljning: ${e.title}”. Inga bilagor skickas. Det kan visas som en separat tråd i Outlook.` : "Den sparade texten skickas i samma konversation."}</p><label><input type="checkbox" checked={approved} disabled={dirty || busy} onChange={v => setApproved(v.target.checked)} /> Jag godkänner denna mottagare och exakt den sparade texten.</label><button className="btn primary" disabled={!approved || dirty || busy || !snapshot.executionEnabled} onClick={() => run("execute", { approved: true })}>Godkänn och skicka en gång</button>{dirty && <p>Spara ändringarna och granska igen.</p>}</section>}
    </>}
    {(task.status === "executing" || task.status === "uncertain") && <p className="assistant-alert">Resultatet måste kontrolleras hos leverantören. Automatisk omsändning är spärrad. Markera som hanterat först när du vet vad som hände.</p>}
    {task.status === "waiting" && task.kind !== "website" && <><p>{task.observedReplyAt ? "Ett nytt meddelande har kommit i konversationen. Granska det innan någon uppföljning skickas." : "Leverantören tog emot åtgärden. Detta bekräftar inte att mottagaren har läst eller svarat."}</p><button className="btn" disabled={busy || Boolean(task.observedReplyAt)} onClick={() => run("follow_up")}>Förbered separat uppföljning</button>{task.kind === "forward" && <p>En uppföljning skapas endast om en entydig obesvarad tråd med rådgivaren hittas för samma ärende och konto.</p>}</>}
    <details><summary>Avsluta eller lämna feedback</summary><label>Din bedömning<textarea maxLength={1000} value={note} onChange={v => setNote(v.target.value)} /></label><label>Kvalitetsomdöme<select value={feedback} onChange={v => setFeedback(v.target.value)}><option value="useful">Användbart</option><option value="wrong_recipient">Fel mottagare</option><option value="not_relevant">Inte relevant</option><option value="missed_task">Missat uppdrag</option><option value="draft_edited">Utkastet behövde ändras</option></select></label><button className="btn" disabled={busy || note.trim().length < 3} onClick={() => run("feedback", { category: feedback, note })}>Spara omdöme</button>
      {!["done", "dismissed"].includes(task.status) && <button className="btn" disabled={busy || note.trim().length < 5} onClick={() => run("complete", { note })}>Jag bekräftar att uppdraget är hanterat</button>}
      {["decision", "ready", "waiting"].includes(task.status) && <button className="btn" disabled={busy} onClick={() => run("dismiss")}>Avstå från uppdraget</button>}
      {task.status === "uncertain" && <button className="btn" disabled={busy} onClick={() => run("dismiss")}>Dölj från Notiscenter</button>}
    </details><PriorityFeedback messageId={e.messageId} initialScore={e.priority || 5} />
  </>;
}
