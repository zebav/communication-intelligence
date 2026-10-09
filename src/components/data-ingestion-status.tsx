"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, RefreshCw, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
type ConnectionStatus = { id: string; provider: string; account: string; status: string; health: string; lastSyncAt: string | null; lastInboundAt: string | null; needsAttention: boolean };
type Status = { pendingMedia: number; failedMedia: number; deadLetterMedia?: number; retrievalPending?: number; retrievalFailed?: number; analysisPending?: number; vaultRetained?: number; connections?: ConnectionStatus[]; error?: string };

function providerLabel(provider: string) {
  return ({ gmail: "Gmail", "microsoft-graph": "Outlook", slack: "Slack", instagram: "Instagram", "whatsapp-business": "WhatsApp" } as Record<string, string>)[provider] ?? provider;
}

function syncLabel(connection: ConnectionStatus) {
  if (connection.status !== "connected" || connection.health === "reconnect_required") return "Logga in igen";
  if (connection.health === "degraded" || connection.health === "error") return "Återställer automatiskt";
  if (!connection.lastSyncAt) return "Väntar på första synkning";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(connection.lastSyncAt).getTime()) / 60_000));
  if (!Number.isFinite(minutes)) return "Synkstatus okänd";
  if (minutes < 2) return "Synkad nyss";
  if (minutes < 60) return `Synkad för ${minutes} min sedan`;
  return `Synkad ${new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(connection.lastSyncAt))}`;
}
function inboundLabel(value: string | null) {
  if (!value) return "Inget inkommande meddelande registrerat ännu";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Senaste inkommande meddelande okänt";
  return `Senaste inkommande: ${new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date)}`;
}
export function DataIngestionStatus({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null); const [refreshing, setRefreshing] = useState(false); const [processing, setProcessing] = useState(false); const [syncMessage, setSyncMessage] = useState("");
  const load = async () => { const response = await fetch("/api/system/data-health", { cache: "no-store" }); const data = await response.json() as Status; if (!response.ok) throw new Error(data.error ?? "Status kunde inte läsas."); setStatus(data); };
  useEffect(() => { void load().catch((error) => setStatus({ pendingMedia: 0, failedMedia: 0, error: error instanceof Error ? error.message : "Status kunde inte läsas." })); const interval = window.setInterval(() => void load().catch(() => undefined), 30_000); return () => window.clearInterval(interval); }, []);
  const refresh = async () => {
    setRefreshing(true); setSyncMessage("");
    try {
      const response = await fetch("/api/system/automation", { method: "POST", headers: { "content-type": "application/json" } });
      const data = await response.json().catch(() => ({})) as { error?: string; queued?: boolean };
      if (!response.ok) throw new Error(data.error ?? "Synkroniseringen kunde inte startas.");
      setSyncMessage(data.queued ? "Hämtning startad. Inkorgen uppdateras automatiskt inom kort." : "Kontrollerar anslutningarnas status.");
      await load();
      window.setTimeout(() => router.refresh(), 8_000);
    } catch (error) {
      setStatus({ pendingMedia: 0, failedMedia: 0, error: error instanceof Error ? error.message : "Synkroniseringen kunde inte startas." });
    } finally { setRefreshing(false); }
  };
  const retryFailed = async () => {
    setProcessing(true);
    try {
      const retry = await fetch("/api/system/data-health", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "retry_failed_media" }) });
      const result = await retry.json() as { error?: string; retried?: number };
      if (!retry.ok) throw new Error(result.error ?? "Bilagorna kunde inte återställas.");
      // Media retrieval, transcription, and document analysis can each take
      // longer than a responsive UI request. Resume through the durable
      // automation queue instead of blocking this screen on several batches.
      const queued = await fetch("/api/system/automation", { method: "POST", headers: { "content-type": "application/json" } });
      const queueResult = await queued.json().catch(() => ({})) as { error?: string; queued?: boolean };
      if (!queued.ok) throw new Error(queueResult.error ?? "Bilagorna återställdes men bakgrundsarbetet kunde inte startas.");
      setSyncMessage(result.retried ? `${result.retried} bilagor är återställda och behandlas nu i bakgrunden.` : "Inga fler bilagor behövde återställas.");
      await load();
      window.setTimeout(() => router.refresh(), 8_000);
    } catch (error) {
      setStatus((current) => ({ pendingMedia: current?.pendingMedia ?? 0, failedMedia: current?.failedMedia ?? 0, connections: current?.connections, error: error instanceof Error ? error.message : "Bilagorna kunde inte återställas." }));
    } finally { setProcessing(false); }
  };
  if (!status) return <div className={`ingestion-status ${compact ? "compact" : ""}`}><RefreshCw size={14} className="spin" /> Kontrollerar att nya meddelanden och bilagor hämtas…</div>;
  if (status.error) return <div className={`ingestion-status warning ${compact ? "compact" : ""}`}><TriangleAlert size={14} /> {status.error}<button className="btn" onClick={() => void refresh()} disabled={refreshing}>Försök igen</button></div>;
  const terminal = status.deadLetterMedia ?? 0;
  const attention = status.pendingMedia > 0 || status.failedMedia > 0 || terminal > 0;
  const message = terminal ? `${terminal} bilag${terminal === 1 ? "a behöver" : "or behöver"} en kontrollerad återkörning. Övriga bilagor hanteras automatiskt.` : status.retrievalFailed ? `${status.retrievalFailed} bilag${status.retrievalFailed === 1 ? "a" : "or"} kunde inte hämtas ännu; systemet försöker igen enligt säker återförsökspolicy.` : status.failedMedia ? `Solvani återställer automatiskt ${status.failedMedia} bilag${status.failedMedia === 1 ? "a" : "or"}. Du behöver bara agera om en anslutning behöver loggas in igen.` : status.retrievalPending ? `Hämtar ${status.retrievalPending} bilag${status.retrievalPending === 1 ? "a" : "or"} och analyserar ${status.analysisPending ?? 0} i bakgrunden.` : "Meddelanden och sparade bilagor är i synk.";
  const stale = status.connections?.filter((connection) => connection.needsAttention) ?? [];
  return <div className={`ingestion-status ${attention || stale.length ? "warning" : ""} ${compact ? "compact" : ""}`} aria-live="polite"><div>{attention || stale.length ? <TriangleAlert size={14} /> : <CheckCircle2 size={14} />}<span><strong>Datainhämtning</strong><small>{syncMessage || message}{!compact && !syncMessage && stale.length ? ` · ${stale.length} anslut${stale.length === 1 ? "ning behöver" : "ningar behöver"} synk eller kontroll.` : ""}</small></span></div><div className="ingestion-status-actions">{terminal > 0 && <button className="btn" onClick={() => void retryFailed()} disabled={refreshing || processing}>{processing ? "Återställer…" : "Återkör säkert"}</button>}<button className="btn" onClick={() => void refresh()} disabled={refreshing || processing}>{refreshing ? "Kontrollerar…" : "Kontrollera nu"}</button></div>{!compact && stale.length > 0 && <small className="ingestion-stale">Kontrollera: {stale.slice(0, 3).map((connection) => connection.account).join(" · ")}{stale.length > 3 ? ` + ${stale.length - 3} till` : ""}</small>}{!compact && (status.connections?.length ?? 0) > 0 && <details className="ingestion-connection-details"><summary>Visa status per källa</summary><ul>{status.connections?.map((connection) => <li key={connection.id}><strong>{providerLabel(connection.provider)}</strong><span>{connection.account}</span><small className={connection.needsAttention ? "negative" : ""}>{syncLabel(connection)} · {inboundLabel(connection.lastInboundAt)}</small></li>)}</ul></details>}</div>;
}
