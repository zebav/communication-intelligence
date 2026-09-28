"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, RefreshCw, TriangleAlert } from "lucide-react";
type Status = { pendingMedia: number; failedMedia: number; connections?: { id: string; provider: string; account: string; health: string; lastSyncAt: string | null; needsAttention: boolean }[]; error?: string };
export function DataIngestionStatus({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null); const [refreshing, setRefreshing] = useState(false); const [processing, setProcessing] = useState(false);
  const load = async () => { const response = await fetch("/api/system/data-health", { cache: "no-store" }); const data = await response.json() as Status; if (!response.ok) throw new Error(data.error ?? "Status kunde inte läsas."); setStatus(data); };
  useEffect(() => { void load().catch((error) => setStatus({ pendingMedia: 0, failedMedia: 0, error: error instanceof Error ? error.message : "Status kunde inte läsas." })); }, []);
  const refresh = async () => { setRefreshing(true); await load().catch((error) => setStatus({ pendingMedia: 0, failedMedia: 0, error: error instanceof Error ? error.message : "Status kunde inte läsas." })); setRefreshing(false); };
  const processPending = async () => {
    setProcessing(true);
    try {
      // One owner action can safely drain a short queue. Each request claims
      // jobs atomically, so this cannot process the same attachment twice.
      for (let batch = 0; batch < 3; batch += 1) {
        const response = await fetch("/api/vault/process-ingestion", { method: "POST", headers: { "content-type": "application/json" } });
        const data = await response.json() as { more?: boolean; error?: string };
        if (!response.ok) throw new Error(data.error ?? "Bilagorna kunde inte bearbetas.");
        if (!data.more) break;
      }
      await load();
    } catch (error) {
      setStatus((current) => ({ pendingMedia: current?.pendingMedia ?? 0, failedMedia: current?.failedMedia ?? 0, error: error instanceof Error ? error.message : "Bilagorna kunde inte bearbetas." }));
    } finally { setProcessing(false); }
  };
  const retryFailed = async () => {
    setProcessing(true);
    try {
      const retry = await fetch("/api/system/data-health", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "retry_failed_media" }) });
      const result = await retry.json() as { error?: string };
      if (!retry.ok) throw new Error(result.error ?? "Bilagorna kunde inte återställas.");
      await processPending();
    } catch (error) {
      setStatus((current) => ({ pendingMedia: current?.pendingMedia ?? 0, failedMedia: current?.failedMedia ?? 0, connections: current?.connections, error: error instanceof Error ? error.message : "Bilagorna kunde inte återställas." }));
    } finally { setProcessing(false); }
  };
  if (!status) return <div className={`ingestion-status ${compact ? "compact" : ""}`}><RefreshCw size={14} className="spin" /> Kontrollerar att nya meddelanden och bilagor hämtas…</div>;
  if (status.error) return <div className={`ingestion-status warning ${compact ? "compact" : ""}`}><TriangleAlert size={14} /> {status.error}<button className="btn" onClick={() => void refresh()} disabled={refreshing}>Försök igen</button></div>;
  const attention = status.pendingMedia > 0 || status.failedMedia > 0;
  const message = status.failedMedia ? `${status.failedMedia} bilag${status.failedMedia === 1 ? "a behöver" : "or behöver"} kontrolleras.` : status.pendingMedia ? `${status.pendingMedia} bilag${status.pendingMedia === 1 ? "a väntar" : "or väntar"} på analys.` : "Meddelanden och sparade bilagor är i synk.";
  const stale = status.connections?.filter((connection) => connection.needsAttention) ?? [];
  return <div className={`ingestion-status ${attention || stale.length ? "warning" : ""} ${compact ? "compact" : ""}`}><div>{attention || stale.length ? <TriangleAlert size={14} /> : <CheckCircle2 size={14} />}<span><strong>Datainhämtning</strong><small>{message}{!compact && stale.length ? ` · ${stale.length} anslut${stale.length === 1 ? "ning behöver" : "ningar behöver"} synk eller kontroll.` : ""}</small></span></div><div className="ingestion-status-actions">{status.failedMedia > 0 && <button className="btn" onClick={() => void retryFailed()} disabled={processing || refreshing}>{processing ? "Återställer…" : "Försök igen"}</button>}{status.pendingMedia > 0 && <button className="btn" onClick={() => void processPending()} disabled={processing || refreshing}>{processing ? "Analyserar…" : "Bearbeta nu"}</button>}<button className="btn" onClick={() => void refresh()} disabled={refreshing || processing}>{refreshing ? "Kontrollerar…" : "Uppdatera"}</button></div>{!compact && stale.length > 0 && <small className="ingestion-stale">Kontrollera: {stale.slice(0, 3).map((connection) => connection.account).join(" · ")}{stale.length > 3 ? ` + ${stale.length - 3} till` : ""}</small>}</div>;
}
