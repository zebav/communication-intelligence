"use client";

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, CalendarClock, RefreshCw, ShieldCheck } from "lucide-react";

type Summary = { states: Record<string, number> };
type ConnectionAccount = { provider: string; account: string; status: string; health: string; lastSyncAt: string | null; syncState?: "current" | "delayed" | "unknown" };
type AutomationOperation = { operation: string; status: string; attempts: number; updatedAt: string | null; error: string | null };
type Operations = {
  connections: Summary & { total: number; attention: number; latestSyncAt: string | null; accounts: ConnectionAccount[] };
  media: Summary & { recentFailures: Array<{ at: string | null; code: string }> };
  scheduled: Summary & { recentFailures: Array<{ at: string | null; code: string }> };
  calendar: { total: number; successful: number; failed: number; nextRunAt: string | null };
  browser: Summary;
  relationships: Summary & { latest: { status?: string; current_stage?: string; processed_people?: number; skipped_people?: number; total_people?: number; error?: string | null } | null };
  automation: Summary & { latestByOperation: AutomationOperation[]; recentRecoveries: Array<{ at: string | null; operation: string; attempts: number }>; recentFailures: Array<{ at: string | null; operation: string; code: string }> };
  partial: boolean;
  generatedAt: string;
  error?: string;
};

function stateText(states: Record<string, number>) {
  const values = Object.entries(states);
  return values.length ? values.map(([state, count]) => `${count} ${state}`).join(" · ") : "Inga jobb ännu";
}
function time(value: string | null) { return value ? new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—"; }
function providerName(provider: string) {
  return ({ gmail: "Gmail", "microsoft-graph": "Outlook", slack: "Slack", instagram_professional: "Instagram", "instagram-professional": "Instagram", whatsapp: "WhatsApp", "whatsapp-business": "WhatsApp" } as Record<string, string>)[provider] ?? provider;
}
function accountState(account: ConnectionAccount) {
  if (account.status !== "connected" || account.health === "reconnect_required") return "Inloggning krävs";
  if (account.health === "degraded" || account.health === "error") return "Kontrolleras";
  if (account.syncState === "delayed") return "Försenad hämtning — systemet försöker igen";
  if (account.syncState === "unknown") return "Väntar på första hämtning";
  return "I synk";
}
function automationLabel(operation: string) {
  return ({
    gmail_intelligence: "Gmail",
    outlook_intelligence: "Outlook",
    instagram_intelligence: "Instagram",
    whatsapp_intelligence: "WhatsApp",
    slack_intelligence: "Slack",
    calendar_sync: "Kalender",
    vault_ingestion: "Dokument & media",
    relationship_backfill: "Relationsanalys",
    autonomous_learning: "Inlärning",
    follow_up_detection: "Uppföljningar",
    notification_orchestration: "Notiscenter",
  } as Record<string, string>)[operation] ?? operation.replaceAll("_", " ");
}
function automationState(operation: AutomationOperation) {
  if (operation.status === "failed") return "Behöver återställas";
  if (operation.status === "retrying") return "Försöker igen automatiskt";
  if (operation.status === "running") return "Arbetar";
  if (operation.status === "queued") return "Köad";
  if (operation.status === "completed") return "Klar";
  return "Väntar på status";
}

export function OperationsDashboard() {
  const [data, setData] = useState<Operations | null>(null);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/system/operations", { cache: "no-store" });
      const body = await response.json() as Operations;
      if (!response.ok) throw new Error(body.error ?? "Driftstatus kunde inte läsas.");
      setData(body);
    } catch (error) { setData({ connections: { states: {}, total: 0, attention: 0, latestSyncAt: null, accounts: [] }, media: { states: {}, recentFailures: [] }, scheduled: { states: {}, recentFailures: [] }, calendar: { total: 0, successful: 0, failed: 0, nextRunAt: null }, browser: { states: {} }, relationships: { states: {}, latest: null }, automation: { states: {}, latestByOperation: [], recentRecoveries: [], recentFailures: [] }, partial: false, generatedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "Driftstatus kunde inte läsas." }); }
    finally { setLoading(false); }
  };
  useEffect(() => { queueMicrotask(() => { void load(); }); }, []);
  if (!data) return <div className="empty-card"><RefreshCw size={14} className="spin" /> Hämtar driftstatus…</div>;
  const relationship = data.relationships.latest;
  const relationshipProcessed = Number(relationship?.processed_people ?? 0) + Number(relationship?.skipped_people ?? 0);
  const relationshipTotal = Number(relationship?.total_people ?? 0);
  const relationshipStatus = !relationship ? "Inte startad" : relationship.status === "pending" ? "Köad" : relationship.status === "running" && relationshipTotal > 0 ? `${relationshipProcessed}/${relationshipTotal} kontakter` : relationship.status === "running" ? "Analyserar kommunikationshistorik" : relationship.status === "completed" ? "Klar" : relationship.status === "failed" ? "Behöver återställas" : relationship.status ?? "Okänd status";
  return <section className="operations-dashboard"><div className="section-title"><Activity size={15} /> Drift & återställning</div><p className="subtitle">Intern, läsbar status för bakgrundsjobb. Inga meddelandetexter, filer eller behörigheter visas här.</p>{data.error ? <div className="empty-card negative">{data.error}</div> : <><div className="cards"><article className="card"><ShieldCheck size={17} /><h3>Anslutningar</h3><strong>{data.connections.attention ? `${data.connections.attention} behöver kontroll` : "I synk"}</strong><p>{data.connections.total} anslutna · senast synk: {time(data.connections.latestSyncAt)}</p></article><article className="card"><Activity size={17} /><h3>Automatik</h3><strong>{stateText(data.automation.states)}</strong><p>Inloggning köar arbetet säkert; systemet fortsätter i bakgrunden.</p></article><article className="card"><Activity size={17} /><h3>Mediajobb</h3><strong>{stateText(data.media.states)}</strong><p>Misslyckade jobb återförsöks automatiskt i begränsade batchar.</p></article><article className="card"><CalendarClock size={17} /><h3>Kalender & utskick</h3><strong>{data.calendar.successful}/{data.calendar.total} kalendrar synkade</strong><p>Utskick: {stateText(data.scheduled.states)} · nästa synk: {time(data.calendar.nextRunAt)}</p></article><article className="card"><Activity size={17} /><h3>Relationsanalys</h3><strong>{relationshipStatus}</strong><p>{relationship?.error ? "Återställningsbart fel" : relationship?.current_stage ?? "Starta från Relationships"}</p></article><article className="card"><Activity size={17} /><h3>Säkra webbuppgifter</h3><strong>{stateText(data.browser.states)}</strong><p>Varje extern handling ligger kvar i godkännandekedjan.</p></article></div>{data.connections.accounts.length > 0 && <section className="learning-confirmed-context"><div className="section-title"><ShieldCheck size={14} /> Synk per anslutet konto</div>{data.connections.accounts.map((account) => <div className="learning-context" key={`${account.provider}-${account.account}`}><strong>{providerName(account.provider)} · {account.account}</strong><br /><small>{accountState(account)} · senast hämtad: {time(account.lastSyncAt)}</small></div>)}</section>}{data.automation.latestByOperation.length > 0 && <section className="learning-confirmed-context"><div className="section-title"><Activity size={14} /> Senaste körning per källa</div>{data.automation.latestByOperation.map((operation) => <div className="learning-context" key={operation.operation}><strong>{automationLabel(operation.operation)}</strong><br /><small className={operation.status === "failed" ? "negative" : ""}>{automationState(operation)} · {time(operation.updatedAt)}{operation.error ? ` · ${operation.error}` : ""}</small></div>)}</section>}{data.automation.recentRecoveries.length > 0 && <section className="learning-confirmed-context"><div className="section-title"><ShieldCheck size={14} /> Återhämtade jobb</div>{data.automation.recentRecoveries.map((item, index) => <div className="learning-context" key={`${item.at}-${item.operation}-${index}`}><strong>{automationLabel(item.operation)}</strong><br /><small>Klart efter {item.attempts} försök · {time(item.at)}</small></div>)}</section>}{(data.media.recentFailures.length > 0 || data.scheduled.recentFailures.length > 0 || data.automation.recentFailures.length > 0) && <section className="learning-confirmed-context"><div className="section-title"><AlertTriangle size={14} /> Senaste återställningsbara fel</div>{[...data.media.recentFailures, ...data.scheduled.recentFailures, ...data.automation.recentFailures].map((item, index) => <div className="learning-context" key={`${item.at}-${index}`}><strong>{time(item.at)}</strong><br /><small>{item.code}</small></div>)}</section>}{data.partial && <p className="muted">En äldre drifttabell saknas eller uppdateras. Övrig status är fortsatt tillgänglig.</p>}</>}<button className="btn" onClick={() => void load()} disabled={loading}>{loading ? "Uppdaterar…" : "Uppdatera status"}</button></section>;
}
