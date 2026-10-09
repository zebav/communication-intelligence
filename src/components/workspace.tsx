"use client";

import dynamic from "next/dynamic";
const AssistantWorkspace = dynamic(() => import("@/components/assistant-workspace").then(module => module.AssistantWorkspace), { loading: () => <p>Öppnar handlingsinkorgen…</p> });
const CalendarWorkspace = dynamic(() => import("@/components/calendar-workspace").then(module => module.CalendarWorkspace), { loading: () => <p>Öppnar kalendern…</p> });
const ContactDuplicates = dynamic(() => import("@/components/contact-duplicates").then(module => module.ContactDuplicates), { loading: () => <p>Öppnar sammanslagningar…</p> });
const ContactAddressBookSync = dynamic(() => import("@/components/contact-address-book-sync").then(module => module.ContactAddressBookSync), { loading: () => <p>Hämtar kontaktsynkning…</p> });
import { ContactAvatar } from "@/components/contact-avatar";
const PersonalKnowledgeVault = dynamic(() => import("@/components/personal-knowledge-vault").then(module => module.PersonalKnowledgeVault), { loading: () => <p>Öppnar personlig kontext…</p> });
const DocumentVault = dynamic(() => import("@/components/document-vault").then(module => module.DocumentVault), { loading: () => <p>Öppnar dokument och media…</p> });
const ServiceToolLayer = dynamic(() => import("@/components/service-tool-layer").then(module => module.ServiceToolLayer), { loading: () => <p>Hämtar tjänster och säkerhetsregler…</p> });
const OperationsDashboard = dynamic(() => import("@/components/operations-dashboard").then(module => module.OperationsDashboard), { loading: () => <p>Hämtar driftstatus…</p> });
const RelationshipWorkspace = dynamic(() => import("@/components/relationship-workspace").then(module => module.RelationshipWorkspace), { loading: () => <p>Hämtar relationsanalys…</p> });
const MessageAttachments = dynamic(() => import("@/components/message-attachments").then(module => module.MessageAttachments), { loading: () => null });
const PriorityFeedback = dynamic(() => import("@/components/priority-feedback").then(module => module.PriorityFeedback), { loading: () => null });
const AccountPlan = dynamic(() => import("@/components/account-plan").then(module => module.AccountPlan), { loading: () => <p>Hämtar abonnemang…</p> });
const DataIngestionStatus = dynamic(() => import("@/components/data-ingestion-status").then(module => module.DataIngestionStatus), { loading: () => <p className="muted">Kontrollerar datainhämtning…</p> });
const ScheduledSendControl = dynamic(() => import("@/components/scheduled-send-control").then(module => module.ScheduledSendControl), { loading: () => null });
const SentMessages = dynamic(() => import("@/components/sent-messages").then(module => module.SentMessages), { loading: () => <p className="muted">Öppnar skickade meddelanden…</p> });

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Archive, Bell, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleUserRound, Clock3, Command, FileUp, Inbox, LayoutDashboard, Link2, LogOut, Mail, MapPin, MessageCircle, MoreHorizontal, PanelRightOpen, Search, Send, Settings, Sparkles, Target, Users, WandSparkles, X } from "lucide-react";
import { actionLabels, type CalendarLearningEvent, type ChannelConnection, type CommunicationCase, type CommunicationOutcome, type CommunicationPersonOption, type FollowUpCommitment, type IntelligentPerson, type LearningSignal, type RecommendedAction, type Source, type SyncedEmailConversation, type UniversalCommunicationProfile } from "@/lib/domain";
import { signOut } from "@/app/auth/actions";
import { analyzeEmailWithAI, correctEmailClassification, createManualCommitment, deeplyAnalyzeEmailWithAI, reviewCommitment, reviewPersonMemory, reviseEmailDraftWithAI, saveSenderPreferences } from "@/app/inbox/actions";
import type { DraftTransformation } from "@/lib/ai/service";
import { emailDashboardExcerpt, emailDashboardSummary, prioritizeEmails } from "@/lib/email-intelligence";
import { isRelevantEmail } from "@/lib/connectors/email-classification";
const PersonaForm = dynamic(() => import("@/components/persona-form").then(module => module.PersonaForm), { loading: () => <p className="muted">Öppnar kommunikationsprofil…</p> });
import { followUpSection } from "@/lib/commitments";
import { reviewLearningSignal } from "@/app/intelligence/actions";
import { deleteCommunicationOutcome, reviewCommunicationOutcome } from "@/app/outcomes/actions";
import { formatResponseTime, outcomeAgeDays } from "@/lib/outcomes";
import { connectorCatalog } from "@/lib/connectors/catalog";
import { accountDisplayLabel } from "@/lib/connectors/account-label";
import { relationshipLabels, relationshipTypes } from "@/lib/relationship-types";
import { PersonLink } from "@/components/person-link";
const ConversationImportForm = dynamic(() => import("@/components/conversation-import-form").then(module => module.ConversationImportForm), { loading: () => <p className="muted">Öppnar import…</p> });
const WhatsAppConnectButton = dynamic(() => import("@/components/whatsapp-connect-button").then(module => module.WhatsAppConnectButton), { loading: () => <p className="muted">Hämtar WhatsApp-anslutning…</p> });
import { communicationPeriods, isWithinCommunicationPeriod, type CommunicationPeriod } from "@/lib/communication-period";
import { statusLabels, type Task, type TaskKind, type TaskStatus } from "@/lib/assistant/model";

export type View = "today" | "cases" | "inbox" | "people" | "followups" | "cleanup" | "intelligence" | "connections" | "settings" | "calendar" | "assistant" | "relationships";
const navigation: { id: View; label: string; icon: typeof Inbox; group: string; count?: number }[] = [
  { id: "today", label: "Idag", icon: LayoutDashboard, group: "IDAG" },
  { id: "inbox", label: "Inkorg", icon: Inbox, group: "KOMMUNIKATION" },
  { id: "assistant", label: "Notiscenter", icon: CheckCircle2, group: "KOMMUNIKATION" },
  { id: "calendar", label: "Kalender", icon: Clock3, group: "ORGANISERA" },
  { id: "relationships", label: "Relationer", icon: Users, group: "ORGANISERA" },
  { id: "people", label: "Kontakter", icon: Users, group: "ORGANISERA" },
  { id: "followups", label: "Uppföljningar", icon: Clock3, group: "VERKTYG" },
  { id: "cases", label: "Analysera", icon: MessageCircle, group: "VERKTYG" },
  { id: "cleanup", label: "Rensa", icon: Archive, group: "SYSTEM" },
  { id: "settings", label: "Inställningar", icon: Settings, group: "SYSTEM" },
];
const mobilePrimaryViews: View[] = ["today", "inbox", "assistant", "relationships", "calendar"];
const sources: { label: string; source: Source }[] = [
  { label: "Email", source: "email" },
  { label: "iMessage", source: "imessage" },
  { label: "Instagram", source: "instagram" },
  { label: "WhatsApp", source: "whatsapp" },
  { label: "Slack", source: "slack" },
  { label: "Messenger", source: "messenger" },
  { label: "Tinder", source: "tinder" },
  { label: "TikTok", source: "tiktok" },
  { label: "LinkedIn", source: "linkedin" },
];
const EMAIL_CATEGORIES = ["Relevant", "Filtered out", "All categories", "Critical", "Action Required", "Business", "Customer", "Personal", "Booking / Travel", "Financial", "Legal", "Receipt / Invoice", "Newsletter", "Marketing", "Notification", "Spam", "Information Only"];

function connectionBelongsToSource(connection: Pick<ChannelConnection, "provider" | "source">, source: Source) {
  if (connection.source === source) return true;
  if (source === "email") return connection.provider === "gmail" || connection.provider === "microsoft-graph";
  if (source === "instagram") return connection.provider === "instagram";
  if (source === "whatsapp") return connection.provider === "whatsapp" || connection.provider === "ycloud";
  if (source === "slack") return connection.provider === "slack";
  return false;
}

export function visibleInboxSources(
  connections: Array<Pick<ChannelConnection, "provider" | "source">>,
  communicationCases: Array<Pick<CommunicationCase, "source">>,
  selectedSource: Source | null,
) {
  return sources.filter((source) => (
    source.source === "email"
    || source.source === selectedSource
    || communicationCases.some((item) => item.source === source.source)
    || connections.some((connection) => connectionBelongsToSource(connection, source.source))
  ));
}

export function shouldAwaitInboxSnapshot({ view, initialView, emailLoadFailed, emailCount }: { view: View; initialView: View; emailLoadFailed: boolean; emailCount: number }) {
  return view === "inbox" && !emailLoadFailed && emailCount === 0 && initialView !== "inbox" && initialView !== "today";
}

function sourceConnectionStatus(source: Source, connections: ChannelConnection[]) {
  const matching = connections.filter((connection) => connectionBelongsToSource(connection, source));
  const connected = matching.filter((connection) => connection.status === "connected");
  if (matching.some((connection) => connection.healthStatus === "degraded" || connection.healthStatus === "error" || connection.healthStatus === "reconnect_required")) return "Åtgärd behövs";
  if (connected.length === 0) return "Inte ansluten";
  return connected.length === 1 ? "Ansluten" : `${connected.length} anslutna`;
}

function formatMessageTime(value?: string) {
  if (!value || Number.isNaN(Date.parse(value))) return "Tidpunkt saknas i det importerade meddelandet";
  return new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

type PlannerSuggestion = NonNullable<NonNullable<CommunicationCase["analysis"]>["planningSuggestion"]>;
type PlannerPlace = { id: string; name: string; address: string; mapsUrl: string };

/** Maps calls occur only after the AI has found a genuine planning request. */
function AIPlanner({ plan }: { plan?: PlannerSuggestion }) {
  const [places, setPlaces] = useState<PlannerPlace[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!plan?.detected || !plan.placeQuery.trim()) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setLoading(true); setStatus("");
      void fetch("/api/calendar/planning", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "places", query: plan.placeQuery }) })
        .then(async (response) => { const data = await response.json() as { places?: PlannerPlace[]; error?: string }; if (!response.ok) throw new Error(data.error ?? "Platsförslagen kunde inte hämtas."); if (active) setPlaces(data.places ?? []); })
        .catch((error) => { if (active) setStatus(error instanceof Error ? error.message : "Platsförslagen kunde inte hämtas."); })
        .finally(() => { if (active) setLoading(false); });
    });
    return () => { active = false; };
  }, [plan?.detected, plan?.placeQuery]);
  if (!plan?.detected) return null;
  return <section className="intel-section ai-planner"><div className="reply-heading"><div><span>AI-planerare</span><small>{plan.kind === "date" ? "Dejtplan" : plan.kind === "meeting" ? "Mötesplan" : "Planeringsunderlag"}</small></div><MapPin size={18} /></div><strong>{plan.objective}</strong><p>{plan.rationale}</p><div className="learning-context">{plan.calendarNeeded ? "Kalendern ska kontrolleras före ett bokningsförslag. " : "Ingen kalenderbokning föreslås ännu. "}{plan.travelNeeded ? "Restid ska kontrolleras när en plats och tid har valts." : "Ingen särskild restidskontroll behövs ännu."}</div>{loading && <p className="muted">Tar fram platsförslag med Google Maps…</p>}{places.length > 0 && <div className="planner-place-list">{places.map((place) => <a className="person-fact" key={place.id} href={place.mapsUrl} target="_blank" rel="noreferrer"><strong>{place.name}</strong><span>{place.address}</span></a>)}</div>}{status && <p className="negative">{status}</p>}<p className="muted">Solvani väljer inte plats eller skapar en bokning utan ditt godkännande.</p></section>;
}

export function Workspace({ userEmail, communicationCases, connections, syncedEmails, emailLoadFailed = false, backgroundPaused = false, followUps, outcomes, calendarHistory, people, learningSignals, persona, profilePeople, initialView = "today", initialSource = null, initialDecisionId }: { userEmail: string; communicationCases: CommunicationCase[]; connections: ChannelConnection[]; syncedEmails: SyncedEmailConversation[]; emailLoadFailed?: boolean; backgroundPaused?: boolean; followUps: FollowUpCommitment[]; outcomes: CommunicationOutcome[]; calendarHistory: CalendarLearningEvent[]; people: IntelligentPerson[]; learningSignals: LearningSignal[]; persona: UniversalCommunicationProfile; profilePeople: CommunicationPersonOption[]; initialView?: View; initialSource?: Source | null; initialDecisionId?: string }) {
  const router = useRouter();
  const automaticSyncStarted = useRef(false);
  const currentView = useRef<View>(initialView);
  const summary = emailDashboardSummary(syncedEmails);
  const [viewState, setViewState] = useState({ initialView, selectedView: initialView });
  // Route changes are server-driven, while taps should feel instant. Derive the
  // active view from the incoming route when it changes instead of scheduling a
  // second state update after every navigation.
  const view = viewState.initialView === initialView ? viewState.selectedView : initialView;
  const setView = useCallback((next: View) => setViewState({ initialView, selectedView: next }), [initialView]);
  const [inboxTab, setInboxTab] = useState("received");
  const [contactTab, setContactTab] = useState("directory");
  const [sentVisited, setSentVisited] = useState(false);
  const [assistantTaskId, setAssistantTaskId] = useState(initialDecisionId ?? "");
  const [decisionStatuses, setDecisionStatuses] = useState<Record<string, InboxDecisionStatus>>({});
  // Decision status is only rendered by Today, Inbox and the notification
  // workspace. Avoid a status request (and a 100-message payload) on every
  // other route, particularly Settings and Contacts.
  const needsDecisionStatus = view === "today" || view === "inbox" || view === "cases";
  const decisionMessageIds = useMemo(() => {
    if (!needsDecisionStatus) return [];
    return [...new Set([
      ...syncedEmails.map((email) => email.messageId),
      ...communicationCases.flatMap((item) => item.threadMessages?.map((message) => message.id) ?? []),
    ].filter(Boolean))].slice(0, 100);
  }, [communicationCases, needsDecisionStatus, syncedEmails]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const requested = new URLSearchParams(window.location.search).get("view");
      if (requested === "today" || requested === "cases" || requested === "inbox" || requested === "people" || requested === "followups" || requested === "cleanup" || requested === "intelligence" || requested === "connections" || requested === "settings" || requested === "calendar" || requested === "assistant" || requested === "relationships") setView(requested);
      if (requested === "sent") { setView("inbox"); setInboxTab("sent"); setSentVisited(true); }
      if (requested === "duplicates") { setView("people"); setContactTab("duplicates"); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [setView]);
  useEffect(() => { currentView.current = view; }, [view]);
  const navigateTo = (next: View, source: Source | null = null, decisionId?: string) => {
    setView(next);
    setSelectedSource(source);
    if (next === "assistant") setAssistantTaskId(decisionId ?? "");
    const params = new URLSearchParams({ view: next });
    if (source) params.set("source", source);
    if (next === "assistant" && decisionId) params.set("decision", decisionId);
    router.replace(`/?${params.toString()}`, { scroll: false });
  };
  const prefetchView = (next: View) => {
    if (next !== view) router.prefetch(`/?view=${next}`);
  };
  const [selectedSource, setSelectedSource] = useState<Source | null>(initialSource);
  useEffect(() => { setSelectedSource(initialSource); }, [initialSource]);
  // Navigating from a lightweight view (for example Notiscenter) is immediate,
  // while the server is still loading the larger mailbox snapshot. An empty
  // client snapshot is therefore not evidence that the mailbox is empty.
  const inboxSnapshotPending = shouldAwaitInboxSnapshot({ view, initialView, emailLoadFailed, emailCount: syncedEmails.length });
  // Keep mobile channel navigation focused on accounts that are actually
  // connected or already contain imported conversations. This avoids sending
  // someone through empty, unavailable source views while still preserving a
  // deep-linked source until the user navigates away from it.
  const availableSources = useMemo(
    () => visibleInboxSources(connections, communicationCases, selectedSource),
    [communicationCases, connections, selectedSource],
  );
  useEffect(() => {
    if (!needsDecisionStatus || !decisionMessageIds.length) return;
    const controller = new AbortController();
    const params = new URLSearchParams();
    decisionMessageIds.forEach((messageId) => params.append("messageId", messageId));
    void fetch(`/api/assistant/status?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { tasks?: InboxDecisionStatus[] };
        if (!response.ok) throw new Error("Beslutsstatus kunde inte läsas.");
        if (!controller.signal.aborted) setDecisionStatuses(Object.fromEntries((data.tasks ?? []).map((task) => [task.message_id, task])));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [decisionMessageIds, needsDecisionStatus]);
  const rememberDecision = (task: InboxDecisionStatus) => setDecisionStatuses((current) => ({ ...current, [task.message_id]: task }));
  const handleAssistantTaskChanged = useCallback((task: Task) => {
    setDecisionStatuses((current) => ({ ...current, [task.message_id]: task }));
    // Completion and dismissal alter the source lists themselves; refresh those
    // only after the durable decision state has been written.
    if (task.status === "done" || task.status === "dismissed") router.refresh();
  }, [router]);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activePersona, setActivePersona] = useState(persona);
  const [commandOpen, setCommandOpen] = useState(false);
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen((open) => !open); } if (event.key === "Escape") setCommandOpen(false); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, []);
  useEffect(() => {
    if (backgroundPaused || automaticSyncStarted.current) return;
    automaticSyncStarted.current = true;
    // Start maintenance after the interactive shell is already visible. The
    // server responds immediately and processes sync, media and AI analysis
    // in the background, so logging in never waits for a mailbox import.
    const queueMaintenance = () => {
      void fetch("/api/system/automation", { method: "POST", headers: { "content-type": "application/json" } })
        .then((response) => {
          // Do not reset an active inbox, editor or decision review merely
          // because background maintenance was queued. Today is a read-only
          // overview, so it alone receives a quiet refresh when it remains
          // visible long enough for the first maintenance pass to finish.
          if (!response.ok) return;
          window.setTimeout(() => {
            if (document.visibilityState === "visible" && currentView.current === "today") router.refresh();
          }, 10_000);
        })
        .catch(() => undefined);
    };
    // Background data work must never compete with the authentication shell
    // and primary interaction work. requestIdleCallback is progressively
    // enhanced for Safari with a bounded timeout fallback.
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof idleWindow.requestIdleCallback === "function") {
      const idleId = idleWindow.requestIdleCallback(queueMaintenance, { timeout: 5_000 });
      return () => idleWindow.cancelIdleCallback?.(idleId);
    }
    const start = window.setTimeout(queueMaintenance, 2_500);
    return () => window.clearTimeout(start);
  }, [backgroundPaused, router]);
  return <div className="workspace">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Image src="/brand/solvani-mark-dark.svg" alt="" width={20} height={20} priority /></span><span>Solvani<br /><small>Relationships. Organized.</small></span></div>
      <button className="command-button" onClick={() => setCommandOpen(true)}><Search size={13} /> Sök eller kommando <kbd>⌘K</kbd></button>
      {navigation.map((item, index) => <Fragment key={item.id}>{item.group !== navigation[index - 1]?.group && <div className="nav-label">{item.group}</div>}{item.id === "inbox" ? <div className="inbox-nav-group">
        <div className="inbox-nav-row"><button className={`nav-button ${view === item.id && selectedSource === null ? "active" : ""}`} onMouseEnter={() => prefetchView(item.id)} onFocus={() => prefetchView(item.id)} onClick={() => { setSelectedSource(null); setSourcesOpen(false); navigateTo(item.id); }}><item.icon size={15} />{item.label}{summary.unread > 0 && <span className="count">{summary.unread}</span>}</button><button className="source-toggle" type="button" aria-label={sourcesOpen ? "Dölj inkorgskällor" : "Visa inkorgskällor"} aria-expanded={sourcesOpen} onClick={() => setSourcesOpen((open) => !open)}>{sourcesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button></div>
        {sourcesOpen && <div className="source-submenu" aria-label="Inkorgskällor">{availableSources.map((source) => { const caseCount = source.source === "email" ? summary.total : communicationCases.filter((item) => item.source === source.source).length; const targetView = source.source === "email" ? "inbox" : "cases"; return <button key={source.source} className={`source-nav-button ${selectedSource === source.source ? "active" : ""}`} onMouseEnter={() => prefetchView(targetView)} onFocus={() => prefetchView(targetView)} onClick={() => { navigateTo(targetView, source.source); setSourcesOpen(false); }}><MessageCircle size={13} /><span>{source.label}</span><small>{sourceConnectionStatus(source.source, connections)}</small>{caseCount > 0 && <span className="count">{caseCount}</span>}</button>; })}</div>}
      </div> : <button className={`nav-button ${view === item.id && selectedSource === null ? "active" : ""}`} onMouseEnter={() => prefetchView(item.id)} onFocus={() => prefetchView(item.id)} onClick={() => { setSelectedSource(null); setSourcesOpen(false); navigateTo(item.id); }}><item.icon size={15} />{item.label}</button>}</Fragment>)}
      <div className="user-chip"><div className="avatar">ZV</div><div className="user-details"><strong>Zebastian</strong><br /><span className="muted" title={userEmail}>{userEmail}</span></div><form action={signOut}><button className="icon-button" type="submit" title="Sign out" aria-label="Sign out"><LogOut size={14} /></button></form></div>
    </aside>
<main className="main">{view === "assistant" && <AssistantWorkspace people={profilePeople} initialTaskId={assistantTaskId || undefined} onTaskChanged={handleAssistantTaskChanged} />}{view === "relationships" && <RelationshipWorkspace />}{view === "calendar" && <CalendarWorkspace conversations={[...syncedEmails.map(e=>({id:e.id,title:e.title,person:e.personName,text:e.threadMessages.map(m=>m.body).join("\n\n")})),...communicationCases.map(c=>({id:c.id,title:c.title,person:c.personName,text:c.message}))].filter((c,i,all)=>all.findIndex(x=>x.id===c.id)===i)} />}{emailLoadFailed && <div className="empty-card" role="alert"><strong>Mejlen kunde inte hämtas</strong><p>Inkorgen kunde inte läsas just nu. Detta betyder inte att den är tom eller att du behöver importera mejlen igen.</p><button className="btn" onClick={() => router.refresh()}>Försök hämta mejlen igen</button></div>}{view === "today" && !emailLoadFailed && <Today emails={syncedEmails.filter((email) => isRelevantEmail(email.classification))} channelCases={communicationCases} decisions={decisionStatuses} onOpenInbox={() => navigateTo("inbox", "email")} onOpenSource={(source) => navigateTo("cases", source)} />}{(view === "inbox" || view === "cases") && <nav className="mobile-channel-switcher" aria-label="Välj inkorgskälla">{availableSources.map((source) => { const targetView = source.source === "email" ? "inbox" : "cases"; const count = source.source === "email" ? summary.total : communicationCases.filter((item) => item.source === source.source).length; return <button key={source.source} type="button" className={selectedSource === source.source || (!selectedSource && source.source === "email" && view === "inbox") ? "active" : ""} aria-pressed={selectedSource === source.source || (!selectedSource && source.source === "email" && view === "inbox")} onClick={() => navigateTo(targetView, source.source)}>{source.label}{count > 0 && <span>{count}</span>}</button>; })}</nav>}{view === "cases" && <CommunicationCases cases={communicationCases} source={selectedSource && selectedSource !== "email" ? selectedSource : undefined} decisions={decisionStatuses} onDecisionChange={rememberDecision} onOpenAssistant={(taskId) => navigateTo("assistant", null, taskId)} />}{view === "inbox" && <div className="toolbar" aria-label="Inkorgsvyer"><button className={`btn ${inboxTab === "received" ? "primary" : ""}`} onClick={() => setInboxTab("received")}>Inkorg</button><button className={`btn ${inboxTab === "sent" ? "primary" : ""}`} onClick={() => { setInboxTab("sent"); setSentVisited(true); }}>Skickade meddelanden</button></div>}{view === "inbox" && inboxTab === "received" && !emailLoadFailed && <InboxView syncedEmails={syncedEmails} waitingForSnapshot={inboxSnapshotPending} people={profilePeople} decisions={decisionStatuses} onDecisionChange={rememberDecision} onOpenAssistant={(taskId) => navigateTo("assistant", null, taskId)} />}{sentVisited && <div hidden={view !== "inbox" || inboxTab !== "sent"}><SentMessages accounts={connections.map(c => ({ id: c.id, name: c.accountIdentifier || c.accountName || "Konto" }))} /></div>}{view === "people" && <><div className="toolbar"><button className={`btn ${contactTab === "directory" ? "primary" : ""}`} onClick={() => setContactTab("directory")}>Kontakter</button><button className={`btn ${contactTab === "duplicates" ? "primary" : ""}`} onClick={() => setContactTab("duplicates")}>Sammanför kontakter</button></div>{contactTab === "directory" ? <div className="page"><ContactAddressBookSync connections={connections} /><People items={people} /></div> : <div className="page"><ContactDuplicates /></div>}</>}{view === "followups" && <FollowUps items={followUps} />}{view === "cleanup" && <CleanUp />}{view === "intelligence" && <Intelligence items={learningSignals} people={profilePeople} followUps={followUps} outcomes={outcomes} calendarHistory={calendarHistory} />}{view === "connections" && <Connections connections={connections} />}{view === "settings" && <SettingsView persona={activePersona} people={profilePeople} learningSignals={learningSignals} followUps={followUps} outcomes={outcomes} calendarHistory={calendarHistory} connections={connections} onSaved={setActivePersona} />}</main>
    {mobileMenuOpen && <div className="mobile-more-overlay" onClick={() => setMobileMenuOpen(false)}><section className="mobile-more-menu" aria-label="Fler delar av Solvani" onClick={(event) => event.stopPropagation()}><div className="mobile-more-head"><div><span>Solvani</span><strong>Mer att utforska</strong></div><button className="icon-button" aria-label="Stäng meny" onClick={() => setMobileMenuOpen(false)}>×</button></div><div className="mobile-more-grid">{navigation.filter((item) => !mobilePrimaryViews.includes(item.id)).map((item) => <button key={item.id} className={view === item.id && selectedSource === null ? "active" : ""} onClick={() => { navigateTo(item.id); setMobileMenuOpen(false); }}><item.icon size={18} /><span>{item.label}</span></button>)}</div></section></div>}
    <nav className="mobile-bar">{navigation.filter((item) => mobilePrimaryViews.includes(item.id)).map((item) => <button key={item.id} className={view === item.id && selectedSource === null ? "active" : ""} onClick={() => { setMobileMenuOpen(false); navigateTo(item.id); }}><item.icon size={17} />{item.label}</button>)}<button className={mobileMenuOpen ? "active" : ""} aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)}><MoreHorizontal size={17} />Mer</button></nav>
    {commandOpen && <CommandBar close={() => setCommandOpen(false)} go={(next) => { setSelectedSource(null); navigateTo(next); setCommandOpen(false); }} />}
  </div>;
}

function CommunicationCases({ cases, source, decisions, onDecisionChange, onOpenAssistant }: { cases: CommunicationCase[]; source?: Source; decisions: Record<string, InboxDecisionStatus>; onDecisionChange: (task: InboxDecisionStatus) => void; onOpenAssistant: (taskId?: string) => void }) {
  const visibleCases = source ? cases.filter((item) => item.source === source) : cases;
  const sourceLabel = sources.find((item) => item.source === source)?.label;
  const grouped = Object.entries(visibleCases.reduce<Record<string, Record<string, CommunicationCase[]>>>((sources, item) => {
    const source = item.source || "manual";
    const person = item.personId ?? item.id;
    sources[source] ??= {};
    sources[source][person] ??= [];
    sources[source][person].push(item);
    return sources;
  }, {}));
  return <div className="page"><PageHeader eyebrow={sourceLabel ? `${sourceLabel}-konversationer` : "Manuella och importerade konversationer"} title={sourceLabel ?? "Analysera en konversation"} subtitle={sourceLabel ? `Meddelanden från ${sourceLabel}, med automatisk analys och svarsförslag.` : "Klistra in text eller ladda upp en skärmbild. Solvani identifierar sammanhanget och skapar analys samt ett svarsförslag."} />
    {!source && <><div className="section-title"><FileUp size={14} color="#34d399" /> Lägg till text, skärmbild eller exporterad fil</div><ConversationImportForm /></>}
    {source && <><div className="section-title">{sourceLabel}-konversationer <span className="count">{visibleCases.length}</span></div>{grouped.length === 0 ? <div className="empty-card">Inga {sourceLabel}-konversationer har hämtats ännu.</div> : <div className="source-folders">{grouped.map(([groupSource, people]) => <section className="source-folder" key={groupSource}><div className="source-folder-head"><MessageCircle size={15} /><strong>{groupSource}</strong><span>{Object.keys(people).length} personer</span></div><div className="case-list">{Object.values(people).map((items) => { const ordered = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); return <CommunicationCaseCard item={ordered[0]} key={`${groupSource}-${ordered[0].personName}`} decisions={decisions} onDecisionChange={onDecisionChange} onOpenAssistant={onOpenAssistant} />; })}</div></section>)}</div>}</>}
  </div>;
}

function CommunicationCaseCard({ item, decisions, onDecisionChange, onOpenAssistant }: { item: CommunicationCase; decisions: Record<string, InboxDecisionStatus>; onDecisionChange: (task: InboxDecisionStatus) => void; onOpenAssistant: (taskId?: string) => void }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(item.analysis?.draftResponse ?? "");
  const [status, setStatus] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [decisionWorking, setDecisionWorking] = useState(false);
  const preparedConversation = useRef<string | null>(null);
  const latestInbound = item.threadMessages?.filter((entry) => entry.direction === "in").at(-1);
  const decision = latestInbound?.id ? decisions[latestInbound.id] : undefined;
  useEffect(() => {
    if (!expanded || !["instagram", "slack"].includes(item.source) || item.analysis || preparing || preparedConversation.current === item.id) return;
    preparedConversation.current = item.id;
    setPreparing(true);
    void fetch(`/api/connectors/${item.source}/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: item.id }) })
      .then(async (response) => { const result = await response.json() as { error?: string }; if (!response.ok) throw new Error(result.error ?? "Svarsförslaget kunde inte förberedas."); router.refresh(); })
      .catch((error) => setStatus(error instanceof Error ? error.message : "Svarsförslaget kunde inte förberedas."))
      .finally(() => setPreparing(false));
  }, [expanded, item.analysis, item.id, item.source, preparing, router]);
  const prepareDecision = async () => {
    if (!latestInbound?.id) return;
    setDecisionWorking(true); setStatus("");
    try {
      const response = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "start", messageId: latestInbound.id, kind: "reply" }) });
      const data = await response.json() as { error?: string; task?: InboxDecisionStatus };
      if (!response.ok || !data.task) throw new Error(data.error ?? "Beslutet kunde inte förberedas.");
      let task = data.task;
      if (draft.trim() && draft.trim() !== item.analysis?.draftResponse?.trim()) {
        const saved = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save", id: task.id, revision: task.revision, edit: { draft, recipientPersonId: null, followUpAt: null } }) });
        const savedData = await saved.json() as { error?: string; task?: InboxDecisionStatus };
        if (!saved.ok) throw new Error(savedData.error ?? "Utkastet kunde inte sparas i beslutet.");
        task = savedData.task ?? task;
      }
      onDecisionChange(task); onOpenAssistant(task.id);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Beslutet kunde inte förberedas."); }
    finally { setDecisionWorking(false); }
  };
  const channelLabel = item.source === "whatsapp" ? "WhatsApp" : item.source === "slack" ? "Slack" : "Instagram";
  const timingLabel = { now: "Skicka nu", within_3_hours: "Inom tre timmar", tomorrow_afternoon: "I morgon eftermiddag", in_3_days: "Om tre dagar", no_reply_needed: "Ingen åtgärd behövs" } as const;
  return <article className="case-item communication-case-card"><div className="avatar">{item.personName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</div><div className="case-card-content"><div className="case-title"><PersonLink personId={item.personId} name={item.personName} /><span className="tag">1 {item.source} thread</span>{item.priorityScore != null && <span className="score">{item.priorityScore}</span>}</div><button className="case-card-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}><span className="case-person">{item.title} · {formatMessageTime(item.createdAt)}</span><p>{item.message}</p></button>{expanded && <div className="case-intelligence">{latestInbound?.id && <PriorityFeedback messageId={latestInbound.id} initialScore={item.priorityScore ?? 5} />}{item.threadMessages && item.threadMessages.length > 0 && <div className="case-thread">{item.threadMessages.slice(-24).map((entry) => <div key={entry.id} className={`message ${entry.direction === "out" ? "out" : ""}`}><div className="message-bubble"><ReadableMessage text={entry.body} /><MessageAttachments messageId={entry.id} expected={entry.attachmentCount} /></div><div className="message-meta">{entry.direction === "out" ? "Du" : item.personName} · {channelLabel} · {formatMessageTime(entry.sentAt)}</div></div>)}</div>}{item.analysis ? <><div className="intel-label">AI-bedömning</div><strong>{item.analysis.summary}</strong><p><b>Intent:</b> {item.analysis.intent || "Inte fastställt"}</p><p>{item.analysis.priorityReason}</p>{item.recommendedAction && <span className="pill">{actionLabels[item.recommendedAction as RecommendedAction] ?? item.recommendedAction}</span>}{item.analysis.sendTiming && <div className="learning-notice"><div><strong>Föreslagen svarstid: {timingLabel[item.analysis.sendTiming.recommendation]}</strong><p>{item.analysis.sendTiming.rationale}</p></div></div>}<AIPlanner plan={item.analysis.planningSuggestion} /><div className="intel-label case-reply-label">Föreslaget svar · {item.analysis.draftTone || "Naturlig ton"}</div><textarea value={draft} onChange={(event) => { setDraft(event.target.value); setStatus(""); }} aria-label={`Föreslaget svar till ${item.personName}`} />{decision ? <div className="decision-status-row"><span className="pill">Beslutsstatus: {statusLabels[decision.status]}</span><button className="btn primary" onClick={() => onOpenAssistant(decision.id)}>Öppna sparat beslut</button></div> : <button className="btn primary" disabled={decisionWorking || !latestInbound?.id || !draft.trim()} onClick={() => void prepareDecision()}><Send size={12} />{decisionWorking ? "Sparar beslut…" : "Fortsätt till godkännande"}</button>}{latestInbound?.id && <ScheduledSendControl conversationId={item.id} messageId={latestInbound.id} source={item.source} body={draft} suggestedTiming={item.analysis.sendTiming?.recommendation} suggestedTimingReason={item.analysis.sendTiming?.rationale} disabled={decisionWorking} onScheduled={() => router.refresh()} />}{status && <p className="negative">{status}</p>}</> : <div className="learning-notice"><div><strong>{preparing ? "Tar fram ett svarsförslag…" : "Svarsförslag förbereds"}</strong><p>{preparing ? `Solvani läser den öppnade ${channelLabel}-tråden och sparar ett redigerbart utkast.` : "Öppna tråden igen för att försöka förbereda svaret."}</p></div></div>}{status && !item.analysis && <p className="negative">{status}</p>}</div>}</div></article>;
}

function Today({ emails, channelCases, decisions, onOpenInbox, onOpenSource }: { emails: SyncedEmailConversation[]; channelCases: CommunicationCase[]; decisions: Record<string, InboxDecisionStatus>; onOpenInbox: () => void; onOpenSource: (source: Source) => void }) {
  const [period, setPeriod] = useState<CommunicationPeriod>("today");
  const pendingEmails = emails.filter((email) => email.threadMessages.at(-1)?.direction === "in");
  const visibleEmails = pendingEmails.filter((email) => isWithinCommunicationPeriod(email.receivedAt, period));
  const visibleChannelCases = channelCases.filter((item) => {
    const latest = item.threadMessages?.at(-1);
    const timestamp = latest?.sentAt ?? item.createdAt;
    return item.conversationType !== "imported" && latest?.direction === "in" && isWithinCommunicationPeriod(timestamp, period);
  });
  const ordered = prioritizeEmails(visibleEmails);
  const summary = emailDashboardSummary(visibleEmails);
  const critical = ordered.filter((email) => email.classification === "Critical");
  const respond = ordered.filter((email) => ["RESPOND_NOW", "RESPOND_TODAY", "RESPOND_LATER"].includes(email.recommendedAction) && email.classification !== "Critical" && email.priorityScore >= 4);
  const lowAttention = ordered.filter((email) => email.priorityScore < 4 && email.classification !== "Critical");
  const otherChannels = visibleChannelCases.sort((a, b) => (b.threadMessages?.at(-1)?.sentAt ?? b.createdAt).localeCompare(a.threadMessages?.at(-1)?.sentAt ?? a.createdAt));
  const periodLabel = communicationPeriods.find((item) => item.id === period)?.label ?? "Today";
  const totalPending = visibleEmails.length + visibleChannelCases.length;
  return <div className="page solvani-today"><span className="eyebrow">TODAY</span><h1>What needs your attention</h1><p className="subtitle">Relevant messages and decisions, ordered by urgency, relationship context and what is waiting on you.</p>
    <div className="overview-periods" aria-label="Kommunikationsperiod">{communicationPeriods.map((item) => <button type="button" className={period === item.id ? "active" : ""} aria-pressed={period === item.id} key={item.id} onClick={() => setPeriod(item.id)}>{item.label}</button>)}</div>
    <div className="summary-bar"><div className="summary-stat"><strong>{summary.unread}</strong><span>olästa</span></div><div className="summary-stat"><strong>{summary.needsResponse}</strong><span>behöver svar</span></div><div className="summary-stat"><strong>{summary.critical}</strong><span>brådskande</span></div><div className="summary-stat"><strong>{summary.lowAttention}</strong><span>att notera</span></div></div>
    {totalPending === 0 && <div className="empty-card">Inga relevanta obesvarade meddelanden för {periodLabel.toLowerCase()}.</div>}
    {critical.length > 0 && <><div className="section-title"><Bell size={14} color="#e15d6f" /> Hantera nu <span className="count">{critical.length}</span></div><div className="cards">{critical.map((email) => <LiveEmailCard key={email.id} email={email} decision={email.messageId ? decisions[email.messageId] : undefined} onClick={onOpenInbox} />)}</div></>}
    {respond.length > 0 && <><div className="section-title"><MessageCircle size={14} color="#3b82f6" /> Redo för dig <span className="count">{respond.length}</span></div><div className="cards">{respond.map((email) => <LiveEmailCard key={email.id} email={email} decision={email.messageId ? decisions[email.messageId] : undefined} onClick={onOpenInbox} />)}</div></>}
    {otherChannels.length > 0 && <><div className="section-title"><MessageCircle size={14} color="#8b5cf6" /> Övriga konversationer <span className="count">{otherChannels.length}</span></div><div className="cards">{otherChannels.map((item) => { const messageId = item.threadMessages?.filter((message) => message.direction === "in").at(-1)?.id; const decision = messageId ? decisions[messageId] : undefined; return <article className="card email-card" key={item.id}><div className="card-top"><span>{item.title}</span>{item.priorityScore != null && <span className="priority-badge">{item.priorityScore >= 8 ? "Hög" : "Normal"}</span>}</div><div className="card-person"><ContactAvatar personId={item.personId} name={item.personName} size={32} /><div><PersonLink personId={item.personId} name={item.personName} /><span>{sources.find((source) => source.source === item.source)?.label ?? item.source}</span></div></div><p>{item.analysis?.summary || item.message}</p><button className="pill" onClick={() => onOpenSource(item.source)}>{decision ? `Beslut: ${statusLabels[decision.status]}` : "Öppna konversation"} <ChevronRight size={10} /></button></article>; })}</div></>}
    {lowAttention.length > 0 && <><div className="section-title"><Archive size={14} color="#8b939f" /> Bör noteras <span className="count">{lowAttention.length}</span></div><div className="cards">{lowAttention.map((email) => <LiveEmailCard key={email.id} email={email} decision={email.messageId ? decisions[email.messageId] : undefined} onClick={onOpenInbox} />)}</div></>}
  </div>;
}

function LiveEmailCard({ email, decision, onClick }: { email: SyncedEmailConversation; decision?: InboxDecisionStatus; onClick: () => void }) { const action = actionLabels[email.recommendedAction as RecommendedAction] ?? email.recommendedAction; const urgency = email.priorityScore >= 9 ? "Brådskande" : email.priorityScore >= 7 ? "Hög" : "Normal"; const urgencyClass = email.priorityScore >= 9 ? "urgent" : email.priorityScore >= 7 ? "high" : "normal"; return <article className="card email-card"><div className="card-top"><span>{email.title}</span><span className={`priority-badge ${urgencyClass}`}>{urgency}</span></div><div className="card-person"><ContactAvatar personId={email.personId} name={email.personName} size={32} /><div><PersonLink personId={email.personId} name={email.personName} /><span>{email.classification}</span></div></div><p>{emailDashboardExcerpt(email)}</p><button className="pill" onClick={onClick}>{decision ? `Beslut: ${statusLabels[decision.status]}` : action} <ChevronRight size={10} /></button></article> }

function InboxView({ syncedEmails, waitingForSnapshot = false, people, decisions, onDecisionChange, onOpenAssistant }: { syncedEmails: SyncedEmailConversation[]; waitingForSnapshot?: boolean; people: CommunicationPersonOption[]; decisions: Record<string, InboxDecisionStatus>; onDecisionChange: (task: InboxDecisionStatus) => void; onOpenAssistant: (taskId?: string) => void }) {
  if (syncedEmails.length > 0) return <SyncedInbox emails={syncedEmails} people={people} decisions={decisions} onDecisionChange={onDecisionChange} onOpenAssistant={onOpenAssistant} />;
  if (waitingForSnapshot) return <div className="page" role="status" aria-live="polite"><PageHeader eyebrow="E-POST" title="Hämtar inkorgen" subtitle="Solvani läser den senaste säkra inkorgsvyn." /><div className="empty-card">Hämtar sparade mejl…</div></div>;
  return <div className="page"><PageHeader eyebrow="Email" title="Inbox" subtitle="Mejl från dina anslutna konton." /><div className="empty-card">Inga sparade mejl hittades. Du kan kontrollera kontonas synkronisering under Connections.</div></div>;
}

function compactActionUrl(raw: string) {
  try {
    const url = new URL(raw);
    const path = url.pathname === "/" ? "" : url.pathname;
    const compactPath = path.length > 34 ? `${path.slice(0, 31)}…` : path;
    return { href: url.href, label: `${url.hostname.replace(/^www\./, "")}${compactPath}` };
  } catch {
    return { href: "", label: "" };
  }
}

function ReadableMessage({ text }: { text: string }) {
  const cleaned = text.replace(/\r\n?/g, "\n").replace(/^b_preheader[\s\u00ad\u034f\u200b-\u200f\u2060\ufeff]*/i, "").replace(/[\u00ad\u034f\u200b-\u200f\u2060\ufeff]+/g, "").replace(/_{8,}/g, "\n\n").replace(/\s*\[https:\/\/[^\]]+\/(?:ho|open)\.gif\]\s*$/i, "").trim();
  const blocks = cleaned.split(/\n{2,}/).map((value) => value.trim()).filter((value) => value && !/^<?https?:\/\/[^\s<>]+>?$/i.test(value) && value.replace(/https?:\/\/\S+/gi, "").trim().length > 2);
  const maxVisibleBlockLength = 800;
  const visibleSourceBlocks = blocks.slice(0, 8);
  const visibleBlocks = visibleSourceBlocks.map((block) => block.length > maxVisibleBlockLength ? `${block.slice(0, maxVisibleBlockLength).trimEnd()}…` : block);
  const hiddenBlocks = [...visibleSourceBlocks.flatMap((block) => block.length > maxVisibleBlockLength ? [block.slice(maxVisibleBlockLength).trim()] : []), ...blocks.slice(8)].filter(Boolean);
  const renderLine = (line: string) => line.split(/(<?https:\/\/[^\s<>]+>?)/gi).map((part, index) => { if (!/<?https:\/\//i.test(part)) return <span key={`${index}-${part.slice(0, 12)}`}>{part}</span>; const href = part.replace(/^</, "").replace(/>$/, "").replace(/[),.;!?]+$/, ""); let host = "website"; try { host = new URL(href).hostname.replace(/^www\./, ""); } catch {} return <a className="message-link" href={href} target="_blank" rel="noopener noreferrer" key={`${href}-${index}`}>Open link on {host} ↗</a>; });
  const renderBlocks = (values: string[], offset = 0) => values.map((block, index) => <p key={`${index + offset}-${block.slice(0, 20)}`}>{block.split("\n").map((line, lineIndex) => <span className="message-line" key={lineIndex}>{renderLine(line)}</span>)}</p>);
  return <div className="message-bubble readable-message">{visibleBlocks.length ? renderBlocks(visibleBlocks) : <p>No readable message text is available.</p>}{hiddenBlocks.length > 0 && <details className="message-overflow"><summary>Visa resten av originalmejlet ({hiddenBlocks.length} ytterligare avsnitt)</summary>{renderBlocks(hiddenBlocks, visibleBlocks.length)}</details>}</div>;
}

type InboxDecisionStatus = { id: string; message_id: string; kind: TaskKind; status: TaskStatus; revision: number; updated_at: string };

function SyncedInbox({ emails, people, decisions, onDecisionChange, onOpenAssistant }: { emails: SyncedEmailConversation[]; people: CommunicationPersonOption[]; decisions: Record<string, InboxDecisionStatus>; onDecisionChange: (task: InboxDecisionStatus) => void; onOpenAssistant: (taskId?: string) => void }) {
  const router = useRouter();
  const [category, setCategory] = useState("Relevant");
  const [selectedId, setSelectedId] = useState(emails[0].id);
  const [savingCategory, setSavingCategory] = useState(false);
  const [categoryError, setCategoryError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [deepAnalyzing, setDeepAnalyzing] = useState(false);
  const [deepAnalysisError, setDeepAnalysisError] = useState("");
  const [confirmResearchId, setConfirmResearchId] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyTones, setReplyTones] = useState<Record<string, string>>({});
  const [revising, setRevising] = useState<DraftTransformation | "">("");
  const [forwardPersonIds, setForwardPersonIds] = useState<Record<string, string>>({});
  const [forwardQueries, setForwardQueries] = useState<Record<string, string>>({});
  const [forwardComments, setForwardComments] = useState<Record<string, string>>({});
  const [confirmForwardId, setConfirmForwardId] = useState("");
  const [forwarding, setForwarding] = useState(false);
  const [forwardMessage, setForwardMessage] = useState("");
  const [senderPreferences, setSenderPreferences] = useState<Record<string, { relationshipType: string; manualPriority: number; handlingRule: string }>>({});
  const [savingSender, setSavingSender] = useState(false);
  const [senderError, setSenderError] = useState("");
  const [reviewingMemory, setReviewingMemory] = useState("");
  const [memoryError, setMemoryError] = useState("");
  const [manualFollowUp, setManualFollowUp] = useState({ description: "", owner: "user" as "user" | "sender" | "unknown", dueAt: "" });
  const [savingFollowUp, setSavingFollowUp] = useState(false);
  const [followUpMessage, setFollowUpMessage] = useState("");
  const [decisionWorking, setDecisionWorking] = useState(false);
  const [decisionMessage, setDecisionMessage] = useState("");
  const [insightOpen, setInsightOpen] = useState(false);
  const [mobileConversationOpen, setMobileConversationOpen] = useState(false);
  const automaticallyPrepared = useRef<Set<string>>(new Set());
  const filtered = prioritizeEmails(category === "All categories" ? emails : category === "Relevant" ? emails.filter((email) => isRelevantEmail(email.classification)) : category === "Filtered out" ? emails.filter((email) => !isRelevantEmail(email.classification)) : emails.filter((email) => email.classification === category));
  const selected = filtered.find((email) => email.id === selectedId) ?? filtered[0];
  useEffect(() => {
    if (!selected || selected.analysis || automaticallyPrepared.current.has(selected.id)) return;
    automaticallyPrepared.current.add(selected.id);
    setAnalyzing(true);
    setAnalysisError("");
    void analyzeEmailWithAI({ messageId: selected.messageId, conversationId: selected.id })
      .then((result) => { if (result.error) setAnalysisError(result.error); else router.refresh(); })
      .catch(() => setAnalysisError("Svarsförslaget kunde inte förberedas just nu."))
      .finally(() => setAnalyzing(false));
  }, [router, selected]);
  if (!selected) return <div className="page"><PageHeader eyebrow="Live Outlook inbox" title="Inbox" subtitle="Filter synchronized messages by category." /><div className="inbox-head"><select className="filter" aria-label="Email category" value={category} onChange={(event) => setCategory(event.target.value)}>{EMAIL_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></div><div className="empty-card">No messages match this category.</div></div>;
  const replyDraft = replyDrafts[selected.id] ?? selected.analysis?.draftResponse ?? "";
  const currentDecision = selected.messageId ? decisions[selected.messageId] : undefined;
  const replyTone = replyTones[selected.id] ?? selected.analysis?.draftTone ?? "";
  const forwardSuggestion = selected.analysis?.forwardingSuggestion;
  const roleMatches = people.filter((person) => person.relationship === forwardSuggestion?.recipientRole).sort((a, b) => { const spanish = /spanish|spain|spansk|españa/i.test(`${forwardSuggestion?.reason} ${forwardSuggestion?.introduction}`); if (!spanish) return 0; const score = (person: CommunicationPersonOption) => /spanish|spain|spansk|españa/i.test(`${person.professionalSpecialty} ${person.jurisdiction}`) ? 1 : 0; return score(b) - score(a); });
  const forwardQuery = forwardQueries[selected.id] ?? "";
  const searchablePeople = [...people].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const forwardCandidates = (forwardQuery.trim() ? searchablePeople.filter((person) => [person.name, person.organization, person.relationship, person.professionalSpecialty, person.jurisdiction].join(" ").toLowerCase().includes(forwardQuery.trim().toLowerCase())) : roleMatches.length ? roleMatches : searchablePeople.filter((person) => person.relationship && person.relationship !== "unknown" && person.entityType !== "automated")).slice(0, 20);
  const forwardPersonId = forwardPersonIds[selected.id] ?? forwardCandidates[0]?.id ?? "";
  const forwardComment = forwardComments[selected.id] ?? forwardSuggestion?.introduction ?? "Hi, I am forwarding this message for your review. Please let me know what action you recommend.";
  const senderPreference = senderPreferences[selected.id] ?? { relationshipType: selected.relationshipType ?? "unknown", manualPriority: selected.manualPriority ?? 5, handlingRule: selected.handlingRule ?? "normal" };
  const setReplyDraft = (value: string) => setReplyDrafts((drafts) => ({ ...drafts, [selected.id]: value }));
  const action = actionLabels[selected.recommendedAction as RecommendedAction] ?? selected.recommendedAction;
  const decisionSummary = emailDashboardExcerpt(selected, 360) || selected.title;
  const selectEmail = (id: string) => { setSelectedId(id); setMobileConversationOpen(true); setAnalysisError(""); setDeepAnalysisError(""); setConfirmResearchId(""); setConfirmForwardId(""); setForwardMessage(""); };
  const saveCategory = async (classification: string) => { setSavingCategory(true); setCategoryError(""); const result = await correctEmailClassification({ messageId: selected.messageId, conversationId: selected.id, classification }); if (result.error) setCategoryError(result.error); else router.refresh(); setSavingCategory(false); };
  const saveSender = async () => { if (!selected.personId) return; setSavingSender(true); setSenderError(""); const result = await saveSenderPreferences({ personId: selected.personId, ...senderPreference }); if (result.error) setSenderError(result.error); else router.refresh(); setSavingSender(false); };
  const reviewMemory = async (memoryId: string, decision: "approve" | "reject") => { setReviewingMemory(memoryId); setMemoryError(""); const result = await reviewPersonMemory({ memoryId, decision }); if (result.error) setMemoryError(result.error); else router.refresh(); setReviewingMemory(""); };
  const addFollowUp = async () => { setSavingFollowUp(true); setFollowUpMessage(""); const result = await createManualCommitment({ conversationId: selected.id, messageId: selected.messageId, ...manualFollowUp }); if (result.error) setFollowUpMessage(result.error); else { setFollowUpMessage("Follow-up created. Open Follow-ups in the left menu."); setManualFollowUp({ description: "", owner: "user", dueAt: "" }); router.refresh(); } setSavingFollowUp(false); };
  const analyze = async () => { setAnalyzing(true); setAnalysisError(""); const result = await analyzeEmailWithAI({ messageId: selected.messageId, conversationId: selected.id }); if (result.error) setAnalysisError(result.error); else router.refresh(); setAnalyzing(false); };
  const deepAnalyze = async (researchApproved: boolean) => { setDeepAnalyzing(true); setDeepAnalysisError(""); const result = await deeplyAnalyzeEmailWithAI({ messageId: selected.messageId, conversationId: selected.id, researchApproved }); if (result.error) setDeepAnalysisError(result.error); else { setConfirmResearchId(""); router.refresh(); } setDeepAnalyzing(false); };
  const revise = async (transformation: DraftTransformation) => { setRevising(transformation); const result = await reviseEmailDraftWithAI({ messageId: selected.messageId, conversationId: selected.id, currentDraft: replyDraft, transformation }); if (result.error) setDecisionMessage(result.error); else { setReplyDraft(result.draftResponse ?? replyDraft); setReplyTones((tones) => ({ ...tones, [selected.id]: result.draftTone ?? replyTone })); } setRevising(""); };
  const forwardEmail = async () => { setForwarding(true); setForwardMessage(""); try { const response = await fetch("/api/connectors/microsoft/forward", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: selected.messageId, conversationId: selected.id, recipientPersonId: forwardPersonId, comment: forwardComment }) }); const result = await response.json() as { error?: string }; if (!response.ok) throw new Error(result.error ?? "The email could not be forwarded."); setForwardMessage("Email forwarded securely through Outlook."); setConfirmForwardId(""); } catch (error) { setForwardMessage(error instanceof Error ? error.message : "The email could not be forwarded."); } finally { setForwarding(false); } };
  const prepareDecision = async () => {
    if (!selected.messageId) return;
    const analysis = selected.analysis;
    const context = `${selected.title} ${selected.preview} ${analysis?.summary ?? ""} ${analysis?.intent ?? ""}`;
    const kind = analysis?.forwardingSuggestion?.recommended ? "forward"
      : analysis?.actionSuggestion?.detected ? "website"
      : analysis?.requiresReply && /\\b(möte|middag|lunch|fika|padel|meeting|dinner|coffee|träffas|ses|appointment)\\b/i.test(context) ? "meeting"
      : "reply";
    setDecisionWorking(true); setDecisionMessage("");
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start", messageId: selected.messageId, kind }),
      });
      const data = await response.json() as { error?: string; task?: InboxDecisionStatus };
      if (!response.ok) throw new Error(data.error ?? "Beslutet kunde inte förberedas.");
      let task = data.task;
      // Inbox is a review surface, not a second sending pipeline. Preserve an
      // owner edit in the canonical task before taking the owner to the one
      // approval and execution view.
      if (task && kind === "reply" && replyDraft.trim() && replyDraft.trim() !== selected.analysis?.draftResponse?.trim()) {
        const saved = await fetch("/api/assistant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "save", id: task.id, revision: task.revision, edit: { draft: replyDraft, recipientPersonId: null, followUpAt: null } }),
        });
        const savedData = await saved.json() as { error?: string; task?: InboxDecisionStatus };
        if (!saved.ok) throw new Error(savedData.error ?? "Utkastet kunde inte sparas i beslutet.");
        task = savedData.task ?? task;
      }
      if (task) onDecisionChange(task);
      onOpenAssistant(task?.id);
    } catch (error) {
      setDecisionMessage(error instanceof Error ? error.message : "Beslutet kunde inte förberedas.");
    } finally { setDecisionWorking(false); }
  };

  const priorityLabel = selected.priorityScore >= 9 ? "Kritisk" : selected.priorityScore >= 7 ? "Hög" : selected.priorityScore <= 3 ? "Låg" : "Normal";
  const recommendedAction = selected.analysis?.forwardingSuggestion?.recommended ? `Vidarebefordra till ${relationshipLabels[selected.analysis.forwardingSuggestion.recipientRole as keyof typeof relationshipLabels] ?? selected.analysis.forwardingSuggestion.recipientRole}` : selected.analysis?.actionSuggestion?.detected ? selected.analysis.actionSuggestion.task : selected.analysis?.requiresReply ? "Granska svarsförslaget" : action;
  return <div className={`inbox solvani-inbox ${insightOpen ? "insight-open" : ""} ${mobileConversationOpen ? "mobile-conversation-open" : ""}`}>
    <section className="inbox-col inbox-list"><header className="inbox-head inbox-head--new"><div><h1>Inkorg</h1><span>{filtered.length} relevanta konversationer</span></div><select className="filter" aria-label="E-postkategori" value={category} onChange={(event) => setCategory(event.target.value)}>{EMAIL_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></header>{filtered.map((email) => { const priority = email.priorityScore >= 9 ? "Kritisk" : email.priorityScore >= 7 ? "Hög" : ""; return <button type="button" key={email.id} className={`conversation-row ${selected.id === email.id ? "selected" : ""}`} onClick={() => selectEmail(email.id)}><ContactAvatar personId={email.personId} name={email.personName} size={40} /><div className="conversation-copy"><strong>{email.personName}</strong><span className="conversation-subject">{email.title}</span><p>{email.preview || "Ingen förhandsvisning tillgänglig"}</p></div><div className="row-meta"><time dateTime={email.receivedAt}>{new Intl.DateTimeFormat("sv-SE", { month: "short", day: "numeric" }).format(new Date(email.receivedAt))}</time>{priority && <span className={`priority-badge ${priority.toLowerCase()}`}>{priority}</span>}{email.unread && <i aria-label="Oläst" />}</div></button>; })}</section>
    <section className="inbox-col thread inbox-reader"><header className="thread-head thread-head--new"><button type="button" className="icon-button mobile-inbox-back" aria-label="Tillbaka till inkorgen" onClick={() => setMobileConversationOpen(false)}><ChevronLeft size={18} /></button><ContactAvatar personId={selected.personId} name={selected.personName} size={42} /><div><PersonLink personId={selected.personId} name={selected.personName} /><strong>{selected.title}</strong><span>Outlook · {formatMessageTime(selected.receivedAt)}</span></div><button type="button" className="icon-button insight-toggle" aria-label="Visa Solvanis analys" onClick={() => setInsightOpen(true)}><PanelRightOpen size={18} /></button></header><div className="messages">{selected.analysis && <section className="solvani-insight-card"><div className="solvani-insight-card-head"><span>✦ Solvani</span>{priorityLabel !== "Normal" && <small className={`priority-badge ${priorityLabel.toLowerCase()}`}>{priorityLabel}</small>}</div><strong>{selected.analysis.summary}</strong><p>{selected.analysis.priorityReason}</p><div>{currentDecision ? <><span className="pill">{statusLabels[currentDecision.status]}</span><button className="btn primary" type="button" onClick={() => onOpenAssistant(currentDecision.id)}>Öppna sparat beslut</button></> : <button className="btn primary" disabled={decisionWorking || !selected.messageId} onClick={() => void prepareDecision()}>{decisionWorking ? "Förbereder…" : "Förbered beslut"}</button>}<button className="btn" type="button" onClick={() => setInsightOpen(true)}>Detaljer</button></div>{decisionMessage && <p className="negative">{decisionMessage}</p>}</section>}{selected.threadMessages.length ? selected.threadMessages.map((message) => <article className={`message ${message.direction === "out" ? "out" : ""}`} key={message.id}><div className="message-bubble"><ReadableMessage text={message.body} /><MessageAttachments messageId={message.id} expected={message.attachmentCount} /></div><div className="message-meta">{message.direction === "out" ? "Du" : selected.personName} · Outlook · {formatMessageTime(message.sentAt)}</div></article>) : <article className="message"><div className="message-bubble"><ReadableMessage text={selected.preview || "Ingen läsbar text kunde hittas i meddelandet."} /></div></article>}</div></section>
    <aside className="intel inbox-insight-drawer" aria-label="Solvanis analys"><header className="inbox-insight-head"><div><span>✦ Solvani</span><h2>Rekommenderad åtgärd</h2></div><button className="icon-button" type="button" aria-label="Stäng Solvanis analys" onClick={() => setInsightOpen(false)}><X size={18} /></button></header>
      <div className="intel-section decision-inbox-card"><div className="intel-label">Solvani recommends</div>
        <strong>{decisionSummary}</strong>
        <p>{selected.analysis?.priorityReason || (selected.relevanceReasons ?? [])[0] || "Granska ärendet innan du agerar."}</p>
        <div className="learning-context"><b>Rekommenderad åtgärd:</b> {recommendedAction}</div>
        {selected.analysis?.actionSuggestion?.targetUrl && (() => { const link = compactActionUrl(selected.analysis!.actionSuggestion!.targetUrl); return link.href ? <div className="learning-context decision-link-row"><b>Webbplats:</b> <a href={link.href} title={link.href} target="_blank" rel="noreferrer">{link.label} ↗</a></div> : null; })()}
        <p className="muted">{currentDecision ? "Detta är samma sparade beslut som visas i Notiscenter. Där granskar och godkänner du nästa steg." : "Öppna beslutet för att se exakt vad som händer vid godkännande. Webbuppgifter använder Browserbase och privata uppgifter hämtas endast efter ditt godkännande."}</p>
        {currentDecision ? <div className="decision-status-row"><span className="pill">Beslutsstatus: {statusLabels[currentDecision.status]}</span><button className="btn primary" type="button" onClick={() => onOpenAssistant(currentDecision.id)}>Öppna sparat beslut</button></div> : <button className="btn primary" disabled={decisionWorking || !selected.messageId} onClick={() => void prepareDecision()}>{decisionWorking ? "Förbereder…" : "Förbered beslut i Notiscenter"}</button>}
        {decisionMessage && <p className="negative">{decisionMessage}</p>}
      </div>
      <AIPlanner plan={selected.analysis?.planningSuggestion} />
      <div className="intel-section reply-section" aria-label="Föreslaget e-postsvar"><div className="reply-heading"><div><span>Föreslaget e-postsvar</span><small>{replyTone || "Förbereds automatiskt"}</small></div><WandSparkles size={18} /></div>{replyDraft ? <><textarea aria-label="Redigerbart e-postsvar" value={replyDraft} onChange={(event) => { setReplyDraft(event.target.value); setDecisionMessage(""); }} /><div className="reply-help">Granska och redigera. När du fortsätter sparas texten i samma beslut som visas i Notiscenter innan något kan skickas.</div><div className="toolbar"><button className="btn" onClick={() => void revise("shorter")} disabled={Boolean(revising)}>Kortare</button><button className="btn" onClick={() => void revise("warmer")} disabled={Boolean(revising)}>Varmare</button><button className="btn" onClick={() => void revise("more_professional")} disabled={Boolean(revising)}>Professionellt</button></div>{currentDecision ? <button className="btn send-button send-button-main" type="button" onClick={() => onOpenAssistant(currentDecision.id)}><Send size={14} /> Granska i Notiscenter</button> : <button className="btn send-button send-button-main" type="button" onClick={() => void prepareDecision()} disabled={!replyDraft.trim() || Boolean(revising) || decisionWorking}><Send size={14} /> {decisionWorking ? "Sparar beslut…" : "Fortsätt till godkännande"}</button>}<ScheduledSendControl conversationId={selected.id} messageId={selected.messageId} source="email" body={replyDraft} disabled={Boolean(revising)} onScheduled={() => router.refresh()} /></> : <div className="learning-notice"><div><strong>{analyzing ? "Skapar svarsförslag…" : "Svarsförslag saknas"}</strong><p>{analyzing ? "Solvani förbereder ett redigerbart svar för det öppna e-postmeddelandet." : "Klicka för att skapa ett förslag."}</p><button className="btn" onClick={() => void analyze()} disabled={analyzing}>{analyzing ? "Skapar utkast…" : "Skapa svarsförslag"}</button></div></div>}{analysisError && <p className="negative">{analysisError}</p>}</div>
      <details className="insight-advanced"><summary>Fler insikter och inställningar</summary>
      <div className="intel-section"><div className="intel-label">Kategori</div><select className="filter" aria-label="Korrigera e-postkategori" value={selected.classification} disabled={savingCategory} onChange={(event) => void saveCategory(event.target.value)}>{EMAIL_CATEGORIES.slice(3).map((item) => <option key={item}>{item}</option>)}</select>{categoryError && <p className="negative">{categoryError}</p>}</div>
      <div className="intel-section"><div className="intel-label">Priority</div><strong style={{color:"#86efc2"}}>{selected.priorityScore}/10</strong><PriorityFeedback key={selected.messageId} messageId={selected.messageId} initialScore={selected.priorityScore} /></div>
      <div className="intel-section"><div className="intel-label">Why this relevance?</div>{(selected.relevanceReasons ?? ["Priority currently comes from the message category."]).map((reason) => <p className="muted" key={reason}>{reason}</p>)}</div>
      <div className="intel-section"><div className="intel-label">Sender intelligence · you control this</div><select className="filter" aria-label="Relationship to sender" value={senderPreference.relationshipType} onChange={(event) => setSenderPreferences((values) => ({ ...values, [selected.id]: { ...senderPreference, relationshipType: event.target.value } }))}>{relationshipTypes.map((value) => <option key={value} value={value}>{relationshipLabels[value]}</option>)}</select><label className="muted">Your sender priority: {senderPreference.manualPriority}/10<input aria-label="Sender priority" type="range" min="1" max="10" value={senderPreference.manualPriority} onChange={(event) => setSenderPreferences((values) => ({ ...values, [selected.id]: { ...senderPreference, manualPriority: Number(event.target.value) } }))} /></label><select className="filter" aria-label="Sender handling rule" value={senderPreference.handlingRule} onChange={(event) => setSenderPreferences((values) => ({ ...values, [selected.id]: { ...senderPreference, handlingRule: event.target.value } }))}><option value="normal">Normal handling</option><option value="always_priority">Always prioritize</option><option value="low_priority">Keep low priority</option></select><button className="btn" onClick={() => void saveSender()} disabled={savingSender || !selected.personId}>{savingSender ? "Saving…" : "Save verified sender settings"}</button>{senderError && <p className="negative">{senderError}</p>}</div>
      <div className="intel-section"><div className="intel-label">Recommended action</div><span className="pill">{action}</span></div>
      {selected.analysis ? <><div className="intel-section"><div className="intel-label">AI summary · {Math.round(selected.analysis.confidence * 100)}% confidence</div><p>{selected.analysis.summary}</p></div><div className="intel-section"><div className="intel-label">Intent</div><p>{selected.analysis.intent}</p><small className="muted">{selected.analysis.priorityReason}</small></div>
        {(selected.memories?.length ?? 0) > 0 && <div className="intel-section"><div className="intel-label">Person memory · you approve every fact</div>{selected.memories?.map((memory) => <div className="memory-item" key={memory.id}><p>{memory.content}</p><small className="muted">{memory.category} · {Math.round(memory.confidence * 100)}% confidence</small>{memory.verified ? <span className="pill"><CheckCircle2 size={11} /> Verified by you</span> : <div className="toolbar"><button className="btn" disabled={reviewingMemory === memory.id} onClick={() => void reviewMemory(memory.id, "reject")}>Reject</button><button className="btn primary" disabled={reviewingMemory === memory.id} onClick={() => void reviewMemory(memory.id, "approve")}>{reviewingMemory === memory.id ? "Saving…" : "Approve memory"}</button></div>}</div>)}{memoryError && <p className="negative">{memoryError}</p>}</div>}
        <div className="intel-section reply-section"><div className="reply-heading"><div><span>Föreslaget svar</span><small>{replyTone}</small></div><WandSparkles size={18} /></div>{selected.analysis.requiresReply && replyDraft ? <><textarea aria-label="Redigerbart svarsförslag" value={replyDraft} onChange={(event) => { setReplyDraft(event.target.value); setDecisionMessage(""); }} /><div className="revision-tools" aria-label="Skriv om svarsförslag"><button className="btn" onClick={() => void revise("shorter")} disabled={Boolean(revising)}>{revising === "shorter" ? "Arbetar…" : "Kortare"}</button><button className="btn" onClick={() => void revise("warmer")} disabled={Boolean(revising)}>Varmare</button><button className="btn" onClick={() => void revise("more_direct")} disabled={Boolean(revising)}>Rakare</button><button className="btn" onClick={() => void revise("more_professional")} disabled={Boolean(revising)}>Professionellt</button><button className="btn" onClick={() => void revise("more_diplomatic")} disabled={Boolean(revising)}>Diplomatiskt</button></div><div className="reply-help">Texten sparas i samma beslut innan den kan skickas. Det finns en enda godkännande- och exekveringskedja.</div>{currentDecision ? <button className="btn send-button send-button-main" type="button" onClick={() => onOpenAssistant(currentDecision.id)}><Send size={14} /> Granska i Notiscenter</button> : <button className="btn send-button send-button-main" type="button" onClick={() => void prepareDecision()} disabled={!replyDraft.trim() || Boolean(revising) || decisionWorking}><Send size={14} /> {decisionWorking ? "Sparar beslut…" : "Fortsätt till godkännande"}</button>}<ScheduledSendControl conversationId={selected.id} messageId={selected.messageId} source="email" body={replyDraft} disabled={Boolean(revising)} onScheduled={() => router.refresh()} /></> : <div className="learning-notice"><div><strong>Inget svar är föreslaget ännu</strong><p>Skapa ett granskningsbart utkast först. När det är klart fortsätter du i Notiscenter för godkännande.</p><button className="btn" onClick={() => void analyze()} disabled={analyzing}>{analyzing ? "Skapar utkast…" : "Skapa svarsförslag"}</button></div></div>}</div>
        {selected.analysis.commitment && <div className="intel-section"><div className="intel-label">Suggested commitment — review only</div><p>{selected.analysis.commitment.description}</p>{selected.analysis.commitment.dueAt && <small className="muted">Due: {selected.analysis.commitment.dueAt}</small>}</div>}
        {selected.analysis.actionSuggestion?.detected && <div className="intel-section"><div className="intel-label">Browserbase web action</div><strong>{selected.analysis.actionSuggestion.task}</strong><p>{selected.analysis.actionSuggestion.reason}</p><small className="muted">{selected.analysis.actionSuggestion.type.replaceAll("_", " ")} · {Math.round(selected.analysis.actionSuggestion.confidence * 100)}% confidence</small>{selected.analysis.actionSuggestion.targetUrl ? (() => { const link = compactActionUrl(selected.analysis!.actionSuggestion!.targetUrl); return <div className="learning-context decision-link-row"><a href={link.href} title={link.href} target="_blank" rel="noreferrer">{link.label} ↗</a></div>; })() : <div className="learning-notice"><div><strong>Ingen verifierad webbplats hittades</strong><p>Generera en ny analys innan webbuppgiften kan köras.</p></div></div>}{selected.analysis.actionSuggestion.requiresLogin && <div className="learning-notice"><CheckCircle2 size={16} /><div><strong>Inloggning behövs</strong><p>Handlingskortet frågar efter saknade uppgifter och kan spara dem krypterat i Dina privata uppgifter.</p></div></div>}<button className="btn primary" disabled={decisionWorking || !selected.analysis.actionSuggestion.targetUrl} onClick={() => void prepareDecision()}>Förbered Browserbase-åtgärd</button></div>}</> : <div className="intel-section"><p>Waiting for automatic analysis. The selected email and limited writing-style examples are sent securely to OpenAI. Nothing is sent to the recipient.</p></div>}
      <div className="intel-section deep-analysis-section"><div className="deep-analysis-heading"><div><span>Deep Analysis</span><small>For complex or important messages</small></div><Sparkles size={18} /></div>{selected.deepAnalysis ? <div className="deep-report"><div className="deep-meta">{selected.deepAnalysis.usedWebResearch ? "Includes approved web research" : "Private analysis · no web research"} · {new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(selected.deepAnalysis.createdAt))}</div><h3>Overview</h3><p>{selected.deepAnalysis.overview}</p><h3>What is at stake</h3><p>{selected.deepAnalysis.stakes}</p><h3>Facts stated in the conversation</h3><ul>{selected.deepAnalysis.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul><h3>Interpretations — not confirmed facts</h3>{selected.deepAnalysis.inferences.length ? selected.deepAnalysis.inferences.map((inference) => <div className="deep-inference" key={inference.claim}><p>{inference.claim}</p><small>{Math.round(inference.confidence * 100)}% confidence · {inference.basis}</small></div>) : <p className="muted">No material interpretations.</p>}<h3>Unknowns</h3><ul>{selected.deepAnalysis.unknowns.map((item) => <li key={item}>{item}</li>)}</ul><h3>Your options</h3>{selected.deepAnalysis.options.map((option) => <div className="deep-option" key={option.label}><strong>{option.label}</strong><span><b>Benefits:</b> {option.benefits}</span><span><b>Risks:</b> {option.risks}</span></div>)}<h3>Recommended approach</h3><p>{selected.deepAnalysis.recommendedApproach}</p><h3>Response strategy</h3><p>{selected.deepAnalysis.responseStrategy}</p>{selected.deepAnalysis.sources.length > 0 && <><h3>Web sources</h3><div className="source-list">{selected.deepAnalysis.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.url}><strong>{source.title}</strong><span>{source.supports}</span></a>)}</div></>}{selected.deepAnalysis.researchQuestions.length > 0 && !selected.deepAnalysis.usedWebResearch && <><h3>Research that may help</h3><ul>{selected.deepAnalysis.researchQuestions.map((question) => <li key={question}>{question}</li>)}</ul></>}</div> : <p>This optional analysis separates facts, interpretations, unknowns, choices and risks. It runs only when you press the button.</p>}<div className="deep-actions"><button className="btn primary" disabled={deepAnalyzing} onClick={() => void deepAnalyze(false)}>{deepAnalyzing ? "Working…" : selected.deepAnalysis ? "Run private analysis again" : "Start private deep analysis"}</button><button className="btn" disabled={deepAnalyzing} onClick={() => setConfirmResearchId(selected.id)}>Research with web sources</button></div>{confirmResearchId === selected.id && <div className="research-consent"><strong>Allow web research for this email?</strong><p>The email context and research questions will be sent to OpenAI. Relevant public web sources may be searched. Nothing will be sent to the email recipient.</p><div><button className="btn" disabled={deepAnalyzing} onClick={() => setConfirmResearchId("")}>Cancel</button><button className="btn primary" disabled={deepAnalyzing} onClick={() => void deepAnalyze(true)}>{deepAnalyzing ? "Researching…" : "Yes, research this time"}</button></div></div>}{deepAnalysisError && <p className="negative">{deepAnalysisError}</p>}</div>
      <div className="intel-section manual-followup"><div className="intel-label">Add follow-up yourself</div><input aria-label="Follow-up description" value={manualFollowUp.description} onChange={(event) => setManualFollowUp((value) => ({ ...value, description: event.target.value }))} placeholder="For example: Call them next week" maxLength={300} /><select className="filter" aria-label="Who owes the follow-up" value={manualFollowUp.owner} onChange={(event) => setManualFollowUp((value) => ({ ...value, owner: event.target.value as "user" | "sender" | "unknown" }))}><option value="user">I owe them</option><option value="sender">They owe me</option><option value="unknown">Waiting / unclear</option></select><input aria-label="Follow-up date" type="date" value={manualFollowUp.dueAt} onChange={(event) => setManualFollowUp((value) => ({ ...value, dueAt: event.target.value }))} /><button className="btn primary" disabled={savingFollowUp || !manualFollowUp.description.trim()} onClick={() => void addFollowUp()}>{savingFollowUp ? "Creating…" : "Create follow-up"}</button>{followUpMessage && <p className={followUpMessage.startsWith("Follow-up created") ? "positive" : "negative"}>{followUpMessage}</p>}</div>
      <div className="intel-section"><button className="btn" onClick={analyze} disabled={analyzing}>{analyzing ? "Analyzing…" : selected.analysis ? "Generate a new analysis and reply" : "Analyze now"}</button>{analysisError && <p className="negative">{analysisError}</p>}</div>
      {selected.analysis?.relationshipSuggestion && <div className="intel-section"><div className="intel-label">Suggested relationship · {Math.round(selected.analysis.relationshipSuggestion.confidence * 100)}% confidence</div><strong>{relationshipLabels[selected.analysis.relationshipSuggestion.type as keyof typeof relationshipLabels] ?? selected.analysis.relationshipSuggestion.type}</strong><p className="muted">{selected.analysis.relationshipSuggestion.reason}</p><button className="btn" onClick={() => setSenderPreferences((values) => ({ ...values, [selected.id]: { ...senderPreference, relationshipType: selected.analysis?.relationshipSuggestion?.type ?? "unknown" } }))}>Use this relationship</button></div>}
      <div className="intel-section forward-suggestion"><div className="intel-label">{forwardSuggestion?.recommended ? "Suggested forwarding action" : "Forward email"}</div><p>{forwardSuggestion?.recommended ? forwardSuggestion.reason : "Search for a contact and review the introduction before forwarding."}</p><label>Search recipient<input value={forwardQuery} onChange={(event) => { setForwardQueries((values) => ({ ...values, [selected.id]: event.target.value })); setForwardPersonIds((values) => ({ ...values, [selected.id]: "" })); setConfirmForwardId(""); }} placeholder="Name, company, role or country…" /></label>{forwardCandidates.length ? <><label>Forward to<select className="filter" value={forwardPersonId} onChange={(event) => { setForwardPersonIds((values) => ({ ...values, [selected.id]: event.target.value })); setConfirmForwardId(""); }}><option value="">Select a contact…</option>{forwardCandidates.map((person) => <option key={person.id} value={person.id}>{person.name}{person.organization ? ` · ${person.organization}` : ""}{person.relationship && person.relationship !== "unknown" ? ` · ${relationshipLabels[person.relationship as keyof typeof relationshipLabels] ?? person.relationship}` : ""}</option>)}</select></label><label>Introduction<textarea value={forwardComment} maxLength={4000} onChange={(event) => { setForwardComments((values) => ({ ...values, [selected.id]: event.target.value })); setConfirmForwardId(""); }} /></label>{confirmForwardId === selected.id ? <div className="send-confirm"><strong>Forward this Outlook email now?</strong><p>The original email and your introduction will be sent to the selected person.</p><div><button className="btn" onClick={() => setConfirmForwardId("")} disabled={forwarding}>Cancel</button><button className="btn send-button" onClick={() => void forwardEmail()} disabled={forwarding}>{forwarding ? "Forwarding…" : "Yes, forward now"}</button></div></div> : <button className="btn primary" disabled={!forwardPersonId || !forwardComment.trim()} onClick={() => setConfirmForwardId(selected.id)}>Review forwarding</button>}{forwardMessage && <p className={forwardMessage.startsWith("Email forwarded") ? "positive" : "negative"}>{forwardMessage}</p>}</> : <p className="muted">No matching contacts. Try a name, company, role or country.</p>}</div>
      <div className="intel-section"><div className="intel-label">Relation och åtgärd</div><p className="muted">Välj en verifierad relation själv, eller skapa en ny analys för ett AI-förslag och relevanta åtgärder.</p><select className="filter" aria-label="Utökad relationstyp" value={senderPreference.relationshipType} onChange={(event) => setSenderPreferences((values) => ({ ...values, [selected.id]: { ...senderPreference, relationshipType: event.target.value } }))}>{relationshipTypes.map((value) => <option key={value} value={value}>{relationshipLabels[value]}</option>)}</select><button className="btn" onClick={() => void saveSender()} disabled={savingSender || !selected.personId}>{savingSender ? "Sparar…" : "Spara relation"}</button></div>
      </details>
    </aside>
  </div>;
}

function PageHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) { return <><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p className="subtitle">{subtitle}</p></> }
function People({ items }: { items: IntelligentPerson[] }) {
  const [query, setQuery] = useState("");
  const [contactView, setContactView] = useState<"relevant" | "people" | "organizations" | "automated" | "review" | "all">("relevant");
  const isRelevantContact = (person: IntelligentPerson) => person.conversations.length > 0 || person.memories.length > 0 || person.openLoops > 0 || (person.manualPriority ?? person.overallPriority ?? 0) >= 6 || (person.relationshipType !== "unknown" && person.relationshipType !== "");
  const visibleEntityType = (person: IntelligentPerson) => {
    if (person.entityType !== "person" || person.relationshipType !== "unknown") return person.entityType;
    const value = `${person.name} ${person.organization}`.toLowerCase();
    return /\b(team|support|service|sales|billing|accounts?|info|office|company|group|networks?|conference|institute|university|bank|hotel|booking|business|club|daily|media|foundation|association|society|academy|school|centre|center|store|shop|studio)\b|\b(ab|ltd|inc|llc)\b/.test(value) ? "organization" : person.entityType;
  };
  const filtered = items.filter((person) => { const matchesSearch = [person.name, person.organization, person.relationshipType, person.professionalSpecialty, person.jurisdiction, person.relationshipSummary, ...person.identities.map((identity) => identity.identifier)].join(" ").toLowerCase().includes(query.toLowerCase()); const entityType = visibleEntityType(person); const matchesType = contactView === "all" || (contactView === "relevant" ? isRelevantContact(person) && entityType === "person" : contactView === "people" ? entityType === "person" : contactView === "organizations" ? entityType === "organization" : contactView === "review" ? entityType === "unknown" : entityType === "automated"); return matchesSearch && matchesType; });
  const selected = filtered[0];
  const highPriority = items.filter((person) => (person.manualPriority ?? person.overallPriority ?? 0) >= 8).length;
  const openLoops = items.reduce((sum, person) => sum + person.openLoops, 0);
  // Contacts are a directory. Editing and detailed contact data intentionally
  // live on the dedicated profile route, preventing a second, competing editor
  // from being squeezed into the mobile workspace.
  return <div className="page people-page"><PageHeader eyebrow="KONTAKTER" title="Kontakter" subtitle="Hitta relevanta personer och öppna deras samlade profil." /><div className="summary-bar"><div className="summary-stat"><strong>{items.filter((person) => isRelevantContact(person) && visibleEntityType(person) === "person").length}</strong><span>relevanta kontakter</span></div><div className="summary-stat"><strong>{highPriority}</strong><span>hög prioritet</span></div><div className="summary-stat"><strong>{openLoops}</strong><span>öppna uppföljningar</span></div></div><div className="people-layout people-directory-layout"><section className="people-list"><select className="filter" aria-label="Kontaktgrupp" value={contactView} onChange={(event) => setContactView(event.target.value as typeof contactView)}><option value="relevant">Relevanta kontakter</option><option value="people">Bekräftade personer</option><option value="organizations">Organisationer</option><option value="automated">Automatiska avsändare</option><option value="review">Behöver granskas</option><option value="all">Alla kontakter</option></select><input className="people-search" aria-label="Sök kontakter" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Sök namn, företag eller e-post…" />{filtered.length === 0 ? <div className="empty-card">Inga kontakter matchar din sökning.</div> : filtered.map((person) => <Link className="person-row" key={person.id} href={`/contacts/${person.id}`}><ContactAvatar personId={person.id} name={person.name} size={36} /><div><strong>{person.name}</strong><small>{person.organization || relationshipLabels[person.relationshipType as keyof typeof relationshipLabels] || "Kontakt"}</small></div><div className="person-row-meta"><span>{person.conversations.length}</span><small>konversationer</small></div></Link>)}</section>{selected ? <aside className="person-directory-preview"><ContactAvatar personId={selected.id} name={selected.name} size={72} /><span className="eyebrow">Vald kontakt</span><h2>{selected.name}</h2><p>{selected.relationshipSummary || selected.organization || "Öppna kontakten för sammanhang, historik och redigering."}</p><Link className="btn primary" href={`/contacts/${selected.id}`}>Öppna kontaktprofil</Link></aside> : <div className="empty-card">Välj en kontakt för att öppna profilen.</div>}</div></div>;
  /* The prior embedded editor was intentionally retired. Contact editing has a
     single, route-based implementation above, which keeps keyboard and touch
     controls reliable on mobile.
  return <div className="page people-page"><PageHeader eyebrow="Personal CRM" title="Contacts" subtitle="Relevant relationships first. Automated and unclassified senders are kept in separate sections." /><div className="summary-bar"><div className="summary-stat"><strong>{items.filter((person) => isRelevantContact(person) && visibleEntityType(person) === "person").length}</strong><span>relevant contacts</span></div><div className="summary-stat"><strong>{highPriority}</strong><span>high priority</span></div><div className="summary-stat"><strong>{openLoops}</strong><span>open follow-ups</span></div></div><div className="people-layout"><section className="people-list"><select className="filter" aria-label="Contact directory section" value={contactView} onChange={(event) => setContactView(event.target.value as typeof contactView)}><option value="relevant">Relevant contacts</option><option value="people">Confirmed people</option><option value="organizations">Organizations</option><option value="automated">Automated senders</option><option value="review">Needs review</option><option value="all">All contacts</option></select><input className="people-search" aria-label="Search people" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, company or email…" />{filtered.length === 0 ? <div className="empty-card">No people match your search.</div> : filtered.map((person) => <button className={`person-row ${selected?.id === person.id ? "selected" : ""}`} key={person.id} onClick={() => choose(person)}><ContactAvatar personId={person.id} name={person.name} size={36} /><div><strong>{person.name}</strong><small>{person.organization || person.relationshipType}</small></div><div className="person-row-meta"><span>{person.conversations.length}</span><small>conversations</small></div></button>)}</section>{selected ? <section className="person-detail"><div className="person-detail-head"><ContactPhotoEditor compact personId={selected.id} name={selected.name} /><div><h2>{selected.name}</h2><span>{selected.identities.map((identity) => identity.source).filter((value, index, values) => values.indexOf(value) === index).join(" · ") || "Manual contact"}</span></div>{selected.lastContactAt && <small>Last contact {new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "Europe/Stockholm" }).format(new Date(selected.lastContactAt))}</small>}</div><ContactMergePicker key={selected.id} personId={selected.id} name={selected.name} /><div className="person-metrics"><div><strong>{selected.conversations.length}</strong><span>conversations</span></div><div><strong>{selected.memories.length}</strong><span>verified memories</span></div><div><strong>{selected.openLoops}</strong><span>open follow-ups</span></div><div><strong>{selected.responseRate == null ? "—" : `${selected.responseRate}%`}</strong><span>response coverage</span></div></div><div className="person-detail-grid"><div className="person-editor"><div className="section-title">Your verified information</div><label>Name<input value={editor.name} onChange={(event) => setEditor((value) => ({ ...value, name: event.target.value }))} /></label><label>Organization<input value={editor.organization} onChange={(event) => setEditor((value) => ({ ...value, organization: event.target.value }))} /></label><label>Contact type<select value={editor.entityType} onChange={(event) => setEditor((value) => ({ ...value, entityType: event.target.value as typeof editor.entityType }))}><option value="person">Person</option><option value="organization">Organization</option><option value="automated">Automated sender</option><option value="unknown">Needs review</option></select></label><label>Professional specialty<input value={editor.professionalSpecialty} onChange={(event) => setEditor((value) => ({ ...value, professionalSpecialty: event.target.value }))} placeholder="For example: Spanish law" /></label><label>Country or jurisdiction<input value={editor.jurisdiction} onChange={(event) => setEditor((value) => ({ ...value, jurisdiction: event.target.value }))} placeholder="For example: Spain" /></label><label>Relationship<select value={editor.relationshipType} onChange={(event) => setEditor((value) => ({ ...value, relationshipType: event.target.value }))}>{relationshipTypes.map((value) => <option key={value} value={value}>{relationshipLabels[value]}</option>)}</select></label><label>Your priority: {editor.manualPriority}/10<input type="range" min="1" max="10" value={editor.manualPriority} onChange={(event) => setEditor((value) => ({ ...value, manualPriority: Number(event.target.value) }))} /></label><label>Relationship summary<textarea value={editor.relationshipSummary} onChange={(event) => setEditor((value) => ({ ...value, relationshipSummary: event.target.value }))} placeholder="What matters in this relationship?" /></label><label>Private notes<textarea value={editor.notes} onChange={(event) => setEditor((value) => ({ ...value, notes: event.target.value }))} placeholder="Notes only you can see" /></label><button className="btn primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save person"}</button>{message && <p className={message.startsWith("Person information saved") ? "positive" : "negative"}>{message}</p>}</div><div><div className="section-title">Verified identities</div>{selected.identities.length ? <div className="person-stack">{selected.identities.map((identity) => <div className="person-fact" key={identity.id}><strong>{identity.source}</strong><span>{identity.identifier}</span><small>{identity.verified ? "Verified match" : "Suggested match"}</small></div>)}</div> : <div className="empty-card">No connected identity.</div>}<div className="section-title">Verified memories</div>{selected.memories.length ? <div className="person-stack">{selected.memories.map((memory) => <div className="person-fact" key={memory.id}><strong>{memory.category}</strong><span>{memory.content}</span></div>)}</div> : <div className="empty-card">No memories approved by you yet.</div>}</div></div><div className="section-title">Relationship timeline</div>{selected.conversations.length ? <div className="timeline">{selected.conversations.map((conversation) => <div className="timeline-item" key={conversation.id}><div className="timeline-dot" /><div><strong>{conversation.title}</strong><span>{conversation.summary || "No summary yet."}</span><small>{conversation.source}{conversation.lastMessageAt ? ` · ${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "Europe/Stockholm" }).format(new Date(conversation.lastMessageAt))}` : ""}</small></div></div>)}</div> : <div className="empty-card">No conversations connected to this person yet.</div>}</section> : <div className="empty-card">No people have been imported yet.</div>}</div></div>;
  */
}
function Outcomes({ items }: { items: CommunicationOutcome[] }) {
  const router = useRouter();
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { desiredOutcome: string; status: CommunicationOutcome["status"]; rating: CommunicationOutcome["ownerRating"] | "" }>>({});
  const waiting = items.filter((item) => item.status === "waiting").length;
  const replies = items.filter((item) => item.status === "reply_received").length;
  const successful = items.filter((item) => item.ownerRating === "successful").length;
  const average = items.filter((item) => item.responseTimeMinutes != null).map((item) => item.responseTimeMinutes as number);
  const averageMinutes = average.length ? Math.round(average.reduce((sum, value) => sum + value, 0) / average.length) : null;
  const valueFor = (item: CommunicationOutcome) => drafts[item.id] ?? { desiredOutcome: item.desiredOutcome, status: item.status, rating: item.ownerRating ?? "" };
  const change = (item: CommunicationOutcome, value: Partial<ReturnType<typeof valueFor>>) => setDrafts((current) => ({ ...current, [item.id]: { ...valueFor(item), ...value } }));
  const save = async (item: CommunicationOutcome) => { const value = valueFor(item); setWorking(item.id); setError(""); const result = await reviewCommunicationOutcome({ outcomeId: item.id, status: value.status, rating: value.rating || null, desiredOutcome: value.desiredOutcome }); if (result.error) setError(result.error); else router.refresh(); setWorking(""); };
  const remove = async (item: CommunicationOutcome) => { setWorking(item.id); setError(""); const result = await deleteCommunicationOutcome(item.id); if (result.error) setError(result.error); else router.refresh(); setWorking(""); };
  const statusLabel: Record<CommunicationOutcome["status"], string> = { waiting: "Waiting for reply", reply_received: "Reply received", resolved: "Resolved", follow_up_needed: "Follow-up needed", unknown: "Unknown" };
  return <div className="page outcomes-page"><PageHeader eyebrow="Communication Outcomes & Learning V1" title="What happened after you replied" subtitle="Outlook detects replies. You decide whether the result was successful and what the system may learn." /><div className="summary-bar"><div className="summary-stat"><strong>{waiting}</strong><span>waiting for reply</span></div><div className="summary-stat"><strong>{replies}</strong><span>replies received</span></div><div className="summary-stat"><strong>{successful}</strong><span>confirmed successful</span></div><div className="summary-stat"><strong>{formatResponseTime(averageMinutes)}</strong><span>average response time</span></div></div><div className="learning-notice"><Target size={16} /><div><strong>A reply is evidence, not proof of success</strong><p>The app can detect that someone answered, but only you can confirm whether the conversation achieved the result you wanted.</p></div></div>{error && <div className="empty-card negative">{error}</div>}{items.length === 0 ? <div className="empty-card">No tracked outcomes yet. Existing Outlook conversations appear after the database migration; new replies sent from the app are tracked automatically.</div> : <div className="outcome-list">{items.map((item) => { const value = valueFor(item); const age = outcomeAgeDays(item.createdAt); return <article className="outcome-card" key={item.id}><div className="outcome-head"><div><strong>{item.personName}</strong><span>{item.conversationTitle}</span></div><span className={`outcome-status ${item.status}`}>{statusLabel[item.status]}</span></div><div className="outcome-meta"><span>Tracked {age === 0 ? "today" : `${age} day${age === 1 ? "" : "s"} ago`}</span><span>Response time: {formatResponseTime(item.responseTimeMinutes)}</span></div><label>What did you want to achieve?<textarea value={value.desiredOutcome} onChange={(event) => change(item, { desiredOutcome: event.target.value })} /></label><div className="outcome-fields"><label>Current status<select value={value.status} onChange={(event) => change(item, { status: event.target.value as CommunicationOutcome["status"] })}>{Object.entries(statusLabel).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><label>Your assessment<select value={value.rating} onChange={(event) => change(item, { rating: event.target.value as CommunicationOutcome["ownerRating"] | "" })}><option value="">Not assessed</option><option value="successful">Successful</option><option value="neutral">Neutral</option><option value="unsuccessful">Unsuccessful</option></select></label></div><div className="outcome-actions"><button className="btn negative-button" disabled={working === item.id} onClick={() => void remove(item)}>Delete result</button><button className="btn primary" disabled={working === item.id || !value.desiredOutcome.trim()} onClick={() => void save(item)}>{working === item.id ? "Saving…" : "Confirm result"}</button></div>{item.userConfirmed && <small className="positive">Confirmed by you</small>}</article>; })}</div>}</div>;
}

function FollowUps({ items }: { items: FollowUpCommitment[] }) {
  const router = useRouter();
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const decide = async (id: string, decision: "approve" | "reject" | "complete") => { setWorking(id); setError(""); const result = await reviewCommitment({ commitmentId: id, decision }); if (result.error) setError(result.error); else router.refresh(); setWorking(""); };
  const counts = { mine: items.filter((item) => item.status === "open" && item.owner === "user").length, theirs: items.filter((item) => item.status === "open" && item.owner === "sender").length, review: items.filter((item) => item.status === "suggested").length };
  const orderedSections = ["Review", "Overdue", "I owe them", "They owe me", "Waiting", "Upcoming"];
  return <div className="page"><PageHeader eyebrow="Open loops" title="Follow-ups" subtitle="Real promises and requests from your conversations. AI suggestions require your approval." /><div className="summary-bar"><div className="summary-stat"><strong>{counts.mine}</strong><span>I owe them</span></div><div className="summary-stat"><strong>{counts.theirs}</strong><span>they owe me</span></div><div className="summary-stat"><strong>{counts.review}</strong><span>to review</span></div></div>{error && <div className="empty-card negative">{error}</div>}{items.length === 0 ? <div className="empty-card">No follow-ups yet. Analyze a conversation containing a concrete promise or requested action.</div> : orderedSections.map((section) => { const sectionItems = items.filter((item) => followUpSection(item) === section); if (!sectionItems.length) return null; return <section key={section}><div className="section-title">{section}</div><div className="list">{sectionItems.map((item) => <div className="list-row" key={item.id}><div className="avatar"><Clock3 size={14} /></div><div><strong>{item.personName}</strong><small>{item.conversationTitle}</small></div><div><span>{item.description}</span><small>{Math.round(item.confidence * 100)}% confidence</small></div><div><small className={section === "Overdue" ? "negative" : "muted"}>{item.dueAt ? new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(item.dueAt)) : "No reliable date"}</small>{item.status === "suggested" ? <div className="toolbar"><button className="btn" disabled={working === item.id} onClick={() => void decide(item.id, "reject")}>Reject</button><button className="btn primary" disabled={working === item.id} onClick={() => void decide(item.id, "approve")}>Approve</button></div> : <button className="btn" disabled={working === item.id} onClick={() => void decide(item.id, "complete")}>{working === item.id ? "Saving…" : "Mark complete"}</button>}</div></div>)}</div></section>; })}</div>;
}
type CleanupAction = "archive" | "mark_read" | "move_to_junk";
type CleanupPreview = { key: string; account: string; sender: string; senderAddress: string; count: number; unread: number; categories: string[]; lastSeenAt: string; action: CleanupAction | "unsubscribe_review"; reason: string; unsubscribeUrl?: string; messageIds: string[]; canApply: boolean };
function CleanUp() {
  const [items, setItems] = useState<CleanupPreview[]>([]);
  const [analyzed, setAnalyzed] = useState(0);
  const [lowValue, setLowValue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [account, setAccount] = useState("all");
  const [action, setAction] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [confirmAction, setConfirmAction] = useState<CleanupAction | "">("");
  const [working, setWorking] = useState(false);
  const [resultMessage, setResultMessage] = useState("");
  const scan = async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/cleanup/preview");
      const result = await response.json() as { analyzed?: number; lowValueMessages?: number; suggestions?: CleanupPreview[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "The inbox could not be analyzed.");
      setItems(result.suggestions ?? []); setAnalyzed(result.analyzed ?? 0); setLowValue(result.lowValueMessages ?? 0); setSelected({});
    } catch (scanError) { setError(scanError instanceof Error ? scanError.message : "The inbox could not be analyzed."); }
    finally { setLoading(false); }
  };
  useEffect(() => { queueMicrotask(() => void scan()); }, []);
  const accounts = [...new Set(items.map((item) => item.account))];
  const visible = items.filter((item) => (account === "all" || item.account === account) && (action === "all" || item.action === action) && [item.sender, item.senderAddress, item.account, ...item.categories].join(" ").toLowerCase().includes(query.toLowerCase()));
  const selectedGroups = visible.filter((item) => selected[item.key] && item.canApply);
  const selectedMessageIds = [...new Set(selectedGroups.flatMap((item) => item.messageIds))].slice(0, 50);
  const labels: Record<CleanupPreview["action"], string> = { archive: "Archive", mark_read: "Mark as read", move_to_junk: "Move to junk", unsubscribe_review: "Review subscription" };
  const applyAction = async () => {
    if (!confirmAction || !selectedMessageIds.length) return;
    setWorking(true); setError(""); setResultMessage("");
    try {
      const response = await fetch("/api/cleanup/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageIds: selectedMessageIds, action: confirmAction }) });
      const result = await response.json() as { message?: string; error?: string; failed?: string[] };
      if (!response.ok) throw new Error(result.error ?? "The selected email action could not be completed.");
      setResultMessage(result.failed?.length ? `${result.message} ${result.failed.length} could not be updated.` : result.message ?? "The selected messages were updated.");
      setConfirmAction(""); await scan();
    } catch (applyError) { setError(applyError instanceof Error ? applyError.message : "The selected email action could not be completed."); }
    finally { setWorking(false); }
  };
  const toggleAll = () => {
    const actionable = visible.filter((item) => item.canApply);
    const allSelected = actionable.length > 0 && actionable.every((item) => selected[item.key]);
    setSelected((values) => ({ ...values, ...Object.fromEntries(actionable.map((item) => [item.key, !allSelected])) }));
  };
  return <div className="page">
    <PageHeader eyebrow="Safe Cleanup Actions V2" title="Clean Up" subtitle="Review and apply safe email actions. Internal colleagues are protected and nothing can be permanently deleted." />
    <div className="summary-bar"><div className="summary-stat"><strong>{analyzed}</strong><span>messages analyzed</span></div><div className="summary-stat"><strong>{lowValue}</strong><span>low-value messages</span></div><div className="summary-stat"><strong>{selectedMessageIds.length}</strong><span>selected messages</span></div></div>
    <div className="learning-notice"><CheckCircle2 size={16} /><div><strong>Approval required</strong><p>Only the messages you select will change. Outlook actions are logged. Gmail actions stay unavailable until its write permission is connected.</p></div></div>
    <div className="connector-global-actions">
      <button className="btn primary" disabled={loading} onClick={() => void scan()}>{loading ? "Analyzing connected inboxes…" : "Analyze inboxes again"}</button>
      <button className="btn" disabled={!visible.some((item) => item.canApply)} onClick={toggleAll}>Select all actionable groups</button>
      <select className="filter" aria-label="Cleanup account" value={account} onChange={(event) => setAccount(event.target.value)}><option value="all">All email accounts</option>{accounts.map((value) => <option key={value}>{value}</option>)}</select>
      <select className="filter" aria-label="Cleanup action" value={action} onChange={(event) => setAction(event.target.value)}><option value="all">All suggestions</option><option value="unsubscribe_review">Subscriptions</option><option value="archive">Archive candidates</option><option value="mark_read">Notifications</option><option value="move_to_junk">Spam</option></select>
    </div>
    <div className="connector-global-actions">
      <button className="btn" disabled={!selectedMessageIds.length || working} onClick={() => setConfirmAction("archive")}>Archive selected</button>
      <button className="btn" disabled={!selectedMessageIds.length || working} onClick={() => setConfirmAction("mark_read")}>Mark selected as read</button>
      <button className="btn negative-button" disabled={!selectedMessageIds.length || working} onClick={() => setConfirmAction("move_to_junk")}>Move selected to junk</button>
    </div>
    {confirmAction && <div className="send-confirm"><strong>Apply “{labels[confirmAction]}” to {selectedMessageIds.length} selected message{selectedMessageIds.length === 1 ? "" : "s"}?</strong><p>This changes the messages in Outlook. Nothing is permanently deleted.</p><div><button className="btn" disabled={working} onClick={() => setConfirmAction("")}>Cancel</button><button className="btn primary" disabled={working} onClick={() => void applyAction()}>{working ? "Applying…" : "Yes, apply action"}</button></div></div>}
    <input className="people-search" aria-label="Search cleanup suggestions" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sender, address, category or account…" />
    {resultMessage && <div className="empty-card positive">{resultMessage}</div>}
    {error && <div className="empty-card negative">{error}</div>}
    {!loading && !error && visible.length === 0 ? <div className="empty-card">No cleanup suggestions match these filters.</div> : <div className="list">{visible.map((item) => <div className="list-row" key={item.key}>
      <div>{item.canApply ? <input type="checkbox" aria-label={`Select ${item.sender}`} checked={Boolean(selected[item.key])} onChange={(event) => setSelected((values) => ({ ...values, [item.key]: event.target.checked }))} /> : <Mail size={14} />}</div>
      <div><strong>{item.sender}</strong><small>{item.senderAddress} · {item.account}</small></div>
      <div><span>{item.count} messages · {item.unread} unread</span><small>{item.categories.join(" · ")} · Last {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(item.lastSeenAt))}</small><small className="muted">{item.reason}</small>{!item.canApply && <small className="muted">Preview only. Reconnect Gmail to approve cleanup actions, or relink this legacy message to an account.</small>}</div>
      <div>{item.action === "unsubscribe_review" && item.unsubscribeUrl ? <a className="btn primary" href={item.unsubscribeUrl} target="_blank" rel="noreferrer">Unsubscribe</a> : <span className="pill">{labels[item.action]}</span>}</div>
    </div>)}</div>}
  </div>;
}
function Intelligence({ items, people, followUps, outcomes, calendarHistory }: { items: LearningSignal[]; people: CommunicationPersonOption[]; followUps: FollowUpCommitment[]; outcomes: CommunicationOutcome[]; calendarHistory: CalendarLearningEvent[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<LearningSignal["status"]>("suggested");
  const [category, setCategory] = useState<"all" | "priority" | "tone" | "actions">("all");
  const [rules, setRules] = useState<Record<string, string>>({});
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const categoryFor = (item: LearningSignal) => item.signalType === "category_corrected" ? "priority" as const
    : item.signalType === "outcome_confirmed" ? "actions" as const
    : "tone" as const;
  const labels: Record<LearningSignal["signalType"], string> = {
    draft_accepted: "Svarsstil bekräftad",
    draft_edited: "Svar redigerat",
    tone_requested: "Tonpreferens",
    category_corrected: "Prioriteringsregel",
    outcome_confirmed: "Åtgärd / utfall",
  };
  const counts = {
    suggested: items.filter((item) => item.status === "suggested").length,
    approved: items.filter((item) => item.status === "approved").length,
    dismissed: items.filter((item) => item.status === "dismissed").length,
  };
  const visible = items.filter((item) => item.status === status && (category === "all" || categoryFor(item) === category));
  const decide = async (item: LearningSignal, decision: "approve" | "dismiss" | "delete") => {
    setWorking(item.id); setError("");
    const proposedRule = rules[item.id] ?? item.proposedRule;
    const result = await reviewLearningSignal({ signalId: item.id, decision, proposedRule });
    if (result.error) setError(result.error); else router.refresh();
    setWorking("");
  };
  const provenance = (item: LearningSignal) => {
    const evidence = item.evidence ?? {};
    const repetitions = typeof evidence.repetitions === "number" ? `${evidence.repetitions} observationer` : null;
    const origin = typeof evidence.assistant_relevance === "string" ? "Notiscenter" : item.signalType === "outcome_confirmed" ? "Bekräftat utfall" : "Svar och redigeringar";
    return [origin, item.personName, item.conversationTitle, item.source, repetitions].filter(Boolean).join(" · ");
  };
  const confirmedPeople = people.filter((person) =>
    (person.relationship && person.relationship !== "unknown")
    || Boolean(person.organization)
    || Boolean(person.professionalSpecialty)
    || Boolean(person.jurisdiction)
  ).slice(0, 40);
  const openDeadlines = followUps.filter((item) => item.dueAt && (item.status === "open" || item.status === "suggested")).slice(0, 12);
  const confirmedOutcomes = outcomes.filter((item) => item.userConfirmed || Boolean(item.ownerRating)).slice(0, 12);
  const bookingBuckets = calendarHistory.reduce<Record<string, { label: string; count: number }>>((buckets, event) => {
    const date = new Date(event.startsAt);
    if (Number.isNaN(date.getTime())) return buckets;
    const weekday = new Intl.DateTimeFormat("sv-SE", { weekday: "long" }).format(date);
    const hour = new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", hourCycle: "h23" }).format(date);
    const key = `${weekday}|${hour}`;
    const label = `${weekday} runt ${hour}:00`;
    buckets[key] = { label, count: (buckets[key]?.count ?? 0) + 1 };
    return buckets;
  }, {});
  const bookingPatterns = Object.values(bookingBuckets).filter((item) => item.count >= 2).sort((a, b) => b.count - a.count).slice(0, 4);
  const automaticCount = items.filter((item) => item.learningMode === "automatic" && item.status === "approved").length;
  return <div className="page learning-page"><PageHeader eyebrow="Learning & Memory" title="Vad Solvani har lärt sig" subtitle="Vardagsmönster med tydligt stöd kan användas automatiskt. Osäkra och känsliga slutsatser stannar för din granskning." />
    <div className="summary-bar"><div className="summary-stat"><strong>{counts.suggested}</strong><span>behöver beslut</span></div><div className="summary-stat"><strong>{automaticCount}</strong><span>rutinmönster används automatiskt</span></div><div className="summary-stat"><strong>{confirmedPeople.length}</strong><span>bekräftade kontaktkontexter</span></div></div>
    <div className="learning-notice"><CheckCircle2 size={16} /><div><strong>Spårbart, återställbart lärande</strong><p>Solvani sparar bara återkommande, låg-risk svarsmönster automatiskt. Du kan alltid korrigera, stoppa eller radera en post — känsliga uppgifter kräver granskning.</p></div></div>
    <div className="learning-tabs">{(["suggested", "approved", "dismissed"] as const).map((value) => <button className={status === value ? "active" : ""} key={value} onClick={() => setStatus(value)}>{value === "suggested" ? "Att granska" : value === "approved" ? "Aktiva regler" : "Avfärdade"} <span>{counts[value]}</span></button>)}</div>
    <div className="toolbar" aria-label="Lärandekategori">{([
      ["all", "Allt"],
      ["priority", "Prioritering"],
      ["tone", "Svar & ton"],
      ["actions", "Åtgärder & mönster"],
    ] as const).map(([value, label]) => <button className={`btn ${category === value ? "primary" : ""}`} key={value} onClick={() => setCategory(value)}>{label}</button>)}</div>
    {error && <div className="empty-card negative">{error}</div>}
    {visible.length === 0 ? <div className="empty-card">{status === "suggested" ? "Inga nya AI-förslag väntar på ditt beslut i denna kategori." : "Inga poster matchar denna vy."}</div> : <div className="learning-list">{visible.map((item) => <article className="learning-card" key={item.id}>
      <div className="learning-card-head"><span className="pill">{labels[item.signalType]}</span>{item.learningMode === "automatic" && <span className="pill">Automatiskt sparat</span>}<small>{new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium" }).format(new Date(item.createdAt))}</small></div>
      <p className="learning-observation">{item.observation}</p>
      <div className="learning-context"><strong>Källa:</strong> {provenance(item)}</div>
      <label>Regel / minne för framtida beslut<textarea value={rules[item.id] ?? item.proposedRule} onChange={(event) => setRules((values) => ({ ...values, [item.id]: event.target.value }))} /></label>
      <div className="learning-confidence"><span>Stöd i underlaget · {item.factState === "confirmed" ? "bekräftad uppgift" : item.factState === "uncertain" ? "osäker tolkning" : "AI-tolkning"}</span><strong>{Math.round(item.confidence * 100)}%</strong></div>
      <div className="learning-actions">{status !== "dismissed" && <button className="btn" disabled={working === item.id} onClick={() => void decide(item, "dismiss")}>{status === "approved" ? "Sluta använda" : "Avfärda"}</button>}{status === "dismissed" && <button className="btn negative-button" disabled={working === item.id} onClick={() => void decide(item, "delete")}>{working === item.id ? "Tar bort…" : "Ta bort permanent"}</button>}<button className="btn primary" disabled={working === item.id || !(rules[item.id] ?? item.proposedRule).trim()} onClick={() => void decide(item, "approve")}>{working === item.id ? "Sparar…" : status === "approved" ? "Spara korrigering" : "Godkänn och använd"}</button></div>
    </article>)}</div>}
    <section className="learning-confirmed-context"><div className="section-title"><CircleUserRound size={14} /> Bekräftade relationer och roller</div><p className="subtitle">Detta är strukturerad kontaktkontext som redan är sparad i Contacts, inte AI-gissningar.</p>{confirmedPeople.length === 0 ? <div className="empty-card">Ingen bekräftad relations- eller rollkontext ännu.</div> : <div className="list">{confirmedPeople.map((person) => <div className="list-row" key={person.id}><div className="avatar"><CircleUserRound size={14} /></div><div><strong>{person.name}</strong><small>{[person.relationship, person.organization, person.professionalSpecialty, person.jurisdiction].filter((value) => value && value !== "unknown").join(" · ")}</small></div><div><span className="pill">Verifierad kontaktdata</span></div></div>)}</div>}</section>
    <section className="learning-confirmed-context"><div className="section-title"><Clock3 size={14} /> Åtgärder, deadlines och bokningsmönster</div><p className="subtitle">Detta är observerad strukturerad historik. Den blir inte automatiskt en AI-regel.</p>
      <div className="cards">
        <div className="card"><h3>Aktuella deadlines</h3>{openDeadlines.length === 0 ? <p className="muted">Inga daterade öppna åtaganden.</p> : openDeadlines.map((item) => <div className="learning-context" key={item.id}><strong>{item.personName}</strong> · {item.description}<br /><small>{item.dueAt ? new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium" }).format(new Date(item.dueAt)) : ""} · källa: konversation</small></div>)}</div>
        <div className="card"><h3>Bekräftade utfall</h3>{confirmedOutcomes.length === 0 ? <p className="muted">Inga bekräftade utfall ännu.</p> : confirmedOutcomes.slice(0, 6).map((item) => <div className="learning-context" key={item.id}><strong>{item.personName}</strong> · {item.desiredOutcome}<br /><small>{item.ownerRating ?? item.status} · källa: skickat meddelande / svar</small></div>)}</div>
        <div className="card"><h3>Bokningsmönster</h3>{bookingPatterns.length === 0 ? <p className="muted">För lite bekräftad kalenderhistorik för att visa ett återkommande mönster.</p> : bookingPatterns.map((pattern) => <div className="learning-context" key={pattern.label}><strong>{pattern.label}</strong><br /><small>{pattern.count} bekräftade bokningar · källa: masterkalender</small></div>)}</div>
      </div>
    </section>
  </div>;
}
function Connections({ connections }: { connections: ChannelConnection[] }) {
  const router = useRouter();
  const connectedEmailAccounts = connections.filter((item) => ["microsoft-graph", "gmail"].includes(item.provider) && item.status === "connected");
  const [syncing, setSyncing] = useState("");
  const [syncError, setSyncError] = useState("");
  const [syncResult, setSyncResult] = useState("");
  const discoverAccount = async (connection: ChannelConnection) => {
    const response = await fetch("/api/contacts/discover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ connectionId: connection.id }) });
    const result = await response.json() as { created?: number; scanned?: number; moreAvailable?: boolean; error?: string };
    if (!response.ok) throw new Error(result.error ?? "Historical contact discovery failed.");
    return result;
  };
  const discoverAllContacts = async () => {
    setSyncing("contacts"); setSyncError(""); setSyncResult("");
    const results: string[] = []; const errors: string[] = [];
    for (const account of connectedEmailAccounts) {
      try { const result = await discoverAccount(account); results.push(`${accountDisplayLabel(account)}: ${result.scanned ?? 0} checked, ${result.created ?? 0} new${result.moreAvailable ? " (more history remains)" : " (history complete)"}`); }
      catch (error) { errors.push(`${accountDisplayLabel(account)}: ${error instanceof Error ? error.message : "Contact discovery failed"}`); }
    }
    setSyncResult(`Historical contact discovery completed for ${connectedEmailAccounts.length} accounts. ${results.join(" · ")}`);
    setSyncError(errors.join(" · ")); await router.refresh(); setSyncing("");
  };
  const importAccount = async (connection: ChannelConnection) => {
    const providerPath = connection.provider === "gmail" ? "google" : "microsoft";
    const response = await fetch(`/api/connectors/${providerPath}/sync?connectionId=${connection.id}`, { method: "POST" });
    const result = await response.json() as { imported?: number; error?: string; moreAvailable?: boolean };
    const messageImportError = response.ok ? "" : result.error ?? "The message import failed.";
    const discoveryResponse = await fetch("/api/contacts/discover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ connectionId: connection.id }) });
    const discovery = await discoveryResponse.json() as { created?: number; scanned?: number; createdContacts?: Array<{ name: string; address: string }>; moreAvailable?: boolean; error?: string };
    if (!discoveryResponse.ok) throw new Error([messageImportError, discovery.error ?? "Historical contact discovery failed."].filter(Boolean).join(" "));
    return { imported: result.imported ?? 0, moreAvailable: result.moreAvailable ?? false, contactsCreated: discovery.created ?? 0, contactsScanned: discovery.scanned ?? 0, createdContacts: discovery.createdContacts ?? [], moreContactsAvailable: discovery.moreAvailable ?? false, messageImportError };
  };
  const syncOutlook = async (connection: ChannelConnection) => {
    setSyncing(connection.id); setSyncError(""); setSyncResult("");
    try {
      const result = await importAccount(connection);
      const examples = result.createdContacts.slice(0, 5).map((item) => item.name || item.address).join(", ");
      setSyncResult(`${accountDisplayLabel(connection)}: ${result.imported} messages imported · ${result.contactsScanned} historical contacts checked · ${result.contactsCreated} new contacts created.${examples ? ` New: ${examples}.` : " Existing contacts were matched; no duplicate contacts were created."}${result.moreContactsAvailable ? " More contact history remains; run the import again to continue further back." : " Contact history is complete for this account."}${result.moreAvailable ? " More message history is also available." : ""}`);
      setSyncError(result.messageImportError);
      await router.refresh();
    } catch (error) { setSyncError(`${accountDisplayLabel(connection)}: ${error instanceof Error ? error.message : "The import failed."}`); }
    finally { setSyncing(""); }
  };
  const syncSlack = async (connection: ChannelConnection) => {
    setSyncing(connection.id); setSyncError(""); setSyncResult("");
    try {
      const response = await fetch(`/api/connectors/slack/sync?connectionId=${connection.id}`, { method: "POST" });
      const result = await response.json() as { imported?: number; unavailableConversations?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Slack-meddelandena kunde inte hämtas.");
      const limitedAccess = Number(result.unavailableConversations ?? 0);
      setSyncResult(`${accountDisplayLabel(connection)}: ${result.imported ?? 0} nya Slack-meddelanden hämtades. Relevanta meddelanden analyseras automatiskt.${limitedAccess ? ` ${limitedAccess} konversation${limitedAccess === 1 ? " kunde" : "er kunde"} inte läsas; anslutningen är markerad för automatisk kontroll.` : ""}`);
      await router.refresh();
    } catch (error) { setSyncError(`${accountDisplayLabel(connection)}: ${error instanceof Error ? error.message : "Slack-meddelandena kunde inte hämtas."}`); }
    finally { setSyncing(""); }
  };
  const syncAllOutlook = async (accounts: ChannelConnection[]) => {
    setSyncing("all"); setSyncError(""); setSyncResult("");
    const results: string[] = []; const errors: string[] = []; let total = 0;
    for (const account of accounts) {
      try { const result = await importAccount(account); total += result.imported; results.push(`${accountDisplayLabel(account)}: ${result.contactsScanned} historical contacts checked, ${result.contactsCreated} new${result.moreContactsAvailable ? " (more history remains)" : " (history complete)"}`); if (result.messageImportError) errors.push(`${accountDisplayLabel(account)} message import: ${result.messageImportError}`); }
      catch (error) { errors.push(`${accountDisplayLabel(account)}: ${error instanceof Error ? error.message : "Import failed"}`); }
    }
    setSyncResult(`All ${accounts.length} accounts checked · ${total} messages imported. ${results.join(" · ")}`);
    setSyncError(errors.join(" · "));
    router.refresh(); setSyncing("");
  };
  const capabilityLabels = { fullSync: "Historik", incrementalSync: "Nya meddelanden", pushNotifications: "Direktuppdatering", sendWithApproval: "Skicka efter godkännande" } as const;
  return <div className="page"><PageHeader eyebrow="ANSLUTNA TJÄNSTER" title="Connections" subtitle="Konton hålls åtskilda, behörigheter är krypterade och Solvani hämtar nya meddelanden automatiskt." /><DataIngestionStatus />{syncResult && <div className="empty-card">{syncResult}</div>}{syncError && <div className="empty-card negative">{syncError}</div>}{connectedEmailAccounts.length > 0 && <details className="connector-global-actions"><summary>Avancerad import och kontaktsynk</summary><div><button className="btn primary" onClick={() => void discoverAllContacts()} disabled={Boolean(syncing)}>{syncing === "contacts" ? "Kontrollerar historiska kontakter…" : `Kontrollera historiska kontakter (${connectedEmailAccounts.length} konton)`}</button>{connectedEmailAccounts.length > 1 && <button className="btn" onClick={() => void syncAllOutlook(connectedEmailAccounts)} disabled={Boolean(syncing)}>{syncing === "all" ? "Importerar alla konton…" : `Importera äldre meddelanden (${connectedEmailAccounts.length} konton)`}</button>}</div></details>}<div className="list">{connectorCatalog.map((connector) => {
    const matchingConnections = connections.filter((item) => item.provider === connector.id);
    const connection = matchingConnections[0];
    const connected = connection?.status === "connected";
    const lastSync = connection?.lastSyncAt ? new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(connection.lastSyncAt)) : "Inte synkroniserat ännu";
    const isEmailProvider = connector.id === "microsoft-graph" || connector.id === "gmail";
    const isInstagram = connector.id === "instagram-professional";
    const isWhatsApp = connector.id === "whatsapp-business";
    const isSlack = connector.id === "slack";
    const isLiveSocial = isInstagram || isWhatsApp;
    const needsReconnect = connection?.healthStatus === "reconnect_required" || connection?.healthStatus === "error";
    const connectPath = connector.id === "gmail" ? "/api/connectors/google/start" : isInstagram ? "/api/connectors/instagram/start" : isWhatsApp ? "/api/connectors/whatsapp/start" : isSlack ? "/api/connectors/slack/start" : "/api/connectors/microsoft/start";
    return <div className="list-row" key={connector.id}><div className="avatar"><Link2 size={14} /></div><div><strong>{connector.displayName}</strong>{(isEmailProvider || isLiveSocial || isSlack) && matchingConnections.length > 0 ? matchingConnections.map((item) => <small key={item.id}>{accountDisplayLabel(item)} · {item.healthStatus === "reconnect_required" ? "Återanslutning krävs" : item.status === "connected" ? "Anslutet" : item.status}</small>) : <small>{connector.description}</small>}</div><div className="muted">{needsReconnect ? "Återanslutning krävs för fortsatt import" : connected ? `Anslutet${connection?.lastSyncAt ? ` · Senast synkat: ${lastSync}` : ""}` : connector.setupNote}<small>{Object.entries(capabilityLabels).filter(([key]) => connector.capabilities[key as keyof typeof capabilityLabels]).map(([, label]) => label).join(" · ") || (isLiveSocial || isSlack ? "Säker kontoanslutning" : "Manuell import")}</small></div><div>{connected && isEmailProvider ? <div className="connector-actions">{matchingConnections.length > 1 && <button className="btn primary" onClick={() => void syncAllOutlook(matchingConnections)} disabled={Boolean(syncing)}>{syncing === "all" ? "Importerar alla…" : `Importera alla ${connector.displayName}-konton`}</button>}{matchingConnections.map((item) => <button className="btn" key={item.id} onClick={() => void syncOutlook(item)} disabled={Boolean(syncing)}>{syncing === item.id ? "Importerar…" : `Importera ${accountDisplayLabel(item)}`}</button>)}<a className="btn" href={connectPath}>Lägg till konto</a></div> : isWhatsApp ? <><div className="connector-actions">{connected && <span className="pill"><CheckCircle2 size={11} /> Konto anslutet</span>}</div><WhatsAppConnectButton connected={connected} /></> : isSlack ? <div className="connector-actions">{connected && !needsReconnect && <><span className="pill"><CheckCircle2 size={11} /> Konto anslutet</span>{matchingConnections.map((item) => <button className="btn" key={item.id} onClick={() => void syncSlack(item)} disabled={Boolean(syncing)}>{syncing === item.id ? "Hämtar…" : "Hämta Slack-meddelanden"}</button>)}</>}<a className="btn" href={connectPath}>{needsReconnect ? "Återanslut Slack" : connected ? "Anslut igen Slack" : "Anslut Slack"}</a></div> : isLiveSocial ? <div className="connector-actions">{connected && !needsReconnect && <span className="pill"><CheckCircle2 size={11} /> Konto anslutet</span>}<a className="btn" href={connectPath}>{needsReconnect ? `Återanslut ${connector.displayName}` : connected ? `Anslut igen ${connector.displayName}` : `Anslut ${connector.displayName}`}</a></div> : isEmailProvider ? <a className="btn" href={connectPath}>{connector.id === "gmail" ? "Anslut Gmail" : "Anslut Outlook"}</a> : connector.availability === "available" ? <span className="pill"><CheckCircle2 size={11} /> Manuell import</span> : <button className="btn" disabled>Planerad</button>}</div></div>;
  })}</div></div>;
}
function SettingsView({ persona, people, learningSignals, followUps, outcomes, calendarHistory, connections, onSaved }: { persona: UniversalCommunicationProfile; people: CommunicationPersonOption[]; learningSignals: LearningSignal[]; followUps: FollowUpCommitment[]; outcomes: CommunicationOutcome[]; calendarHistory: CalendarLearningEvent[]; connections: ChannelConnection[]; onSaved: (profile: UniversalCommunicationProfile) => void }) {
  type SettingsTab = "context" | "documents" | "services" | "intelligence" | "connections" | "operations" | "account" | "security";
  const [tab, setTab] = useState<SettingsTab>(() => {
    if (typeof window === "undefined") return "context";
    const requested = new URLSearchParams(window.location.search).get("settings");
    if (requested === "outcomes") return "intelligence";
    return requested === "documents" || requested === "services" || requested === "intelligence" || requested === "connections" || requested === "operations" || requested === "account" || requested === "security" ? requested : "context";
  });
  const groups: Array<{ label: string; items: Array<{ id: SettingsTab; label: string }> }> = [
    { label: "Personligt", items: [{ id: "context", label: "Personlig kontext" }, { id: "intelligence", label: "Lärande och minne" }] },
    { label: "Data", items: [{ id: "documents", label: "Dokument och media" }] },
    { label: "Anslutningar", items: [{ id: "connections", label: "Anslutna konton" }, { id: "services", label: "Tjänster och verktyg" }] },
    { label: "System", items: [{ id: "operations", label: "Drift och diagnostik" }, { id: "security", label: "Säkerhet och integritet" }] },
    { label: "Konto", items: [{ id: "account", label: "Plan och användning" }] },
  ];
  return <div className="page settings-page"><PageHeader eyebrow="INSTÄLLNINGAR" title="Inställningar" subtitle="Personlig kontext, lärande och anslutna tjänster – samlat utan parallella profiler." />
    <nav className="settings-navigation" aria-label="Inställningar">{groups.map((group) => <div className="settings-navigation-group" key={group.label}><span>{group.label}</span>{group.items.map((item) => <button className={tab === item.id ? "active" : ""} key={item.id} aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>)}</nav>
    {tab === "context" && <><div className="section-title"><CircleUserRound size={14} /> Din gemensamma grund</div><p className="subtitle">Din befintliga kommunikationsprofil är kvar som enda källa för hur AI skriver och agerar. Personliga uppgifter ligger säkert i din personliga kontext nedan — utan en parallell profil.</p><PersonaForm initial={persona} people={people} onSaved={onSaved} /><PersonalKnowledgeVault /></>}
    {tab === "documents" && <DocumentVault />}
    {tab === "services" && <ServiceToolLayer />}
    {tab === "intelligence" && <><Intelligence items={learningSignals} people={people} followUps={followUps} outcomes={outcomes} calendarHistory={calendarHistory} /><section className="settings-outcomes"><div className="section-title"><Target size={14} /> Resultat</div><p className="subtitle">Bekräftade resultat hör till lärandet: de hjälper Solvani att förstå vad som fungerade, utan att skapa en separat inställningsdel.</p><Outcomes items={outcomes} /></section></>}
    {tab === "connections" && <Connections connections={connections} />}
    {tab === "operations" && <OperationsDashboard />}
    {tab === "account" && <AccountPlan />}
    {tab === "security" && <div className="cards"><div className="card"><CircleUserRound size={17} /><h3>Konto och säkerhet</h3><p>Supabase Auth med manuell etablering och obligatorisk TOTP-MFA.</p><span className="pill">MFA krävs</span></div><div className="card"><Sparkles size={17} /><h3>AI och integritet</h3><p>Endast relevant kanal, situation och personprofil används för det aktiva meddelandet.</p><span className="pill">Minimalt sammanhang</span></div><div className="card"><CheckCircle2 size={17} /><h3>Profilkontroll</h3><p>AI kan använda din profil men kan inte ändra den eller göra en tolkning till ett sparat faktum.</p><span className="pill">Ägarverifierat</span></div></div>}
  </div>;
}
function CommandBar({ close, go }: { close: () => void; go: (view: View) => void }) { const [query, setQuery] = useState(""); const items = useMemo(() => [{text:"Who do I need to answer today?",view:"today" as View},{text:"Show my smart inbox",view:"inbox" as View},{text:"Show people I promised to contact",view:"followups" as View},{text:"Review low-value newsletters",view:"cleanup" as View}].filter((item) => item.text.toLowerCase().includes(query.toLowerCase())),[query]); return <div className="command-overlay" onMouseDown={close}><div className="command" onMouseDown={(event) => event.stopPropagation()}><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ask about your communication…" /><div className="command-list">{items.map((item) => <div className="command-item" key={item.text} onClick={() => go(item.view)}><Command size={12} style={{display:"inline",marginRight:8}} />{item.text}</div>)}</div></div></div> }
