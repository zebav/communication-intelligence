"use client";

import { useState, useTransition } from "react";
import { startRelationshipBackfill } from "@/app/relationships/actions";

export function RelationshipBackfillControl({ status }: { status?: string | null }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const start = () => startTransition(async () => { const result = await startRelationshipBackfill(); setMessage(result.error ?? (result.alreadyActive ? "Historisk analys kör redan i bakgrunden." : "Historisk analys har startat. Kontakter behandlas i små säkra omgångar.")); });
  return <div className="relationship-backfill"><div><strong>Historical relationship analysis</strong><small>{status === "running" || status === "pending" ? "Working in the background" : "Use your existing communication history to establish initial rankings."}</small></div><button className="btn" disabled={pending || status === "running" || status === "pending"} onClick={start}>{pending ? "Starting…" : status === "running" || status === "pending" ? "In progress" : "Analyze history"}</button>{message && <small>{message}</small>}</div>;
}
