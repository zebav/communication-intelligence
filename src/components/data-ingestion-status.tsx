"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, RefreshCw, TriangleAlert } from "lucide-react";
type Status = { pendingMedia: number; failedMedia: number; error?: string };
export function DataIngestionStatus({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null); const [refreshing, setRefreshing] = useState(false);
  const load = async () => { const response = await fetch("/api/system/data-health", { cache: "no-store" }); const data = await response.json() as Status; if (!response.ok) throw new Error(data.error ?? "Status kunde inte läsas."); setStatus(data); };
  useEffect(() => { void load().catch((error) => setStatus({ pendingMedia: 0, failedMedia: 0, error: error instanceof Error ? error.message : "Status kunde inte läsas." })); }, []);
  const refresh = async () => { setRefreshing(true); await load().catch((error) => setStatus({ pendingMedia: 0, failedMedia: 0, error: error instanceof Error ? error.message : "Status kunde inte läsas." })); setRefreshing(false); };
  if (!status) return <div className={`ingestion-status ${compact ? "compact" : ""}`}><RefreshCw size={14} className="spin" /> Kontrollerar att nya meddelanden och bilagor hämtas…</div>;
  if (status.error) return <div className={`ingestion-status warning ${compact ? "compact" : ""}`}><TriangleAlert size={14} /> {status.error}<button className="btn" onClick={() => void refresh()} disabled={refreshing}>Försök igen</button></div>;
  const attention = status.pendingMedia > 0 || status.failedMedia > 0;
  const message = status.failedMedia ? `${status.failedMedia} bilag${status.failedMedia === 1 ? "a behöver" : "or behöver"} kontrolleras.` : status.pendingMedia ? `${status.pendingMedia} bilag${status.pendingMedia === 1 ? "a analyseras" : "or analyseras"}.` : "Meddelanden och sparade bilagor är i synk.";
  return <div className={`ingestion-status ${attention ? "warning" : ""} ${compact ? "compact" : ""}`}><div>{attention ? <TriangleAlert size={14} /> : <CheckCircle2 size={14} />}<span><strong>Datainhämtning</strong><small>{message}</small></span></div><button className="btn" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "Kontrollerar…" : "Uppdatera"}</button></div>;
}
