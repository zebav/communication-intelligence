"use client";

import { useState, useTransition } from "react";
import { startRelationshipBackfill } from "@/app/relationships/actions";

type Job = { status?: string | null; processedPeople?: number | null; skippedPeople?: number | null; totalPeople?: number | null; stage?: string | null; error?: string | null };

export function RelationshipBackfillControl({ job }: { job?: Job | null }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const start = () => startTransition(async () => { const result = await startRelationshipBackfill(); setMessage(result.error ?? (result.alreadyActive ? "Historisk analys kör redan i bakgrunden." : "Historisk analys har startat. Kontakter behandlas i små säkra omgångar.")); });
  const active = job?.status === "running" || job?.status === "pending";
  const total = Number(job?.totalPeople ?? 0);
  const processed = Number(job?.processedPeople ?? 0) + Number(job?.skippedPeople ?? 0);
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const status = job?.status;
  const description = status === "failed" ? "Analysen pausades av ett återställningsbart fel. Ingen kontaktdata har tagits bort."
    : active ? `${processed} av ${total || "?"} kontakter har kontrollerats · ${percent}% klart.`
    : status === "completed" ? `Klar. ${processed} kontakter kontrollerades. Nya meddelanden uppdaterar sedan analyserna löpande.`
    : "Använd befintlig kommunikationshistorik för att skapa de första rankingarna.";
  return <div className="relationship-backfill"><div><strong>Historisk relationsanalys</strong><small>{description}</small>{active && <div className="relationship-progress" aria-label={`${percent}% klart`}><span style={{ width: `${percent}%` }} /></div>}{job?.error && <small className="negative">{job.error}</small>}</div><button className="btn" disabled={pending || active} onClick={start}>{pending ? "Startar…" : active ? `${percent}% klart` : status === "completed" ? "Analysera igen" : "Analysera historik"}</button>{message && <small>{message}</small>}</div>;
}
