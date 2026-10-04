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
  const hasKnownTotal = total > 0;
  const percent = hasKnownTotal ? Math.min(100, Math.round((processed / total) * 100)) : null;
  const status = job?.status;
  const description = status === "failed" ? "Analysen pausades av ett återställningsbart fel. Ingen kontaktdata har tagits bort."
    : status === "pending" ? "Köad. Solvani startar den historiska analysen i bakgrunden och fortsätter även om du lämnar sidan."
    : status === "running" && hasKnownTotal ? `${processed} av ${total} kontakter analyserade · ${percent}% klart.`
    : status === "running" ? "Analyserar kommunikationshistorik. Den exakta omfattningen räknas fortfarande fram."
    : status === "completed" ? `Klar. ${processed} kontakter kontrollerades. Nya meddelanden uppdaterar sedan analyserna löpande.`
    : "Använd befintlig kommunikationshistorik för att skapa de första rankingarna.";
  const buttonLabel = pending ? "Startar…" : status === "running" ? (hasKnownTotal ? `${percent}% klart` : "Analyserar…") : status === "pending" ? "Köad" : status === "completed" ? "Analysera igen" : "Analysera historik";
  return <div className="relationship-backfill"><div><strong>Historisk relationsanalys</strong><small>{description}</small>{status === "running" && <div className="relationship-progress" aria-label={hasKnownTotal ? `${percent}% klart` : "Analys pågår"} aria-valuemin={0} aria-valuemax={hasKnownTotal ? 100 : undefined} aria-valuenow={percent ?? undefined}><span style={{ width: hasKnownTotal ? `${percent}%` : "38%" }} /></div>}{job?.error && <small className="negative">{job.error}</small>}</div><button className="btn primary" disabled={pending || active} onClick={start}>{buttonLabel}</button>{message && <small>{message}</small>}</div>;
}
