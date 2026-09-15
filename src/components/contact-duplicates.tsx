"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
type Candidate = { sourceId: string; targetId: string; sourceName: string; targetName: string; safe: boolean; reason: string };
type Merge = { id: string; target_id: string; source_profile: { display_name: string; notes?: string }; created_at: string };
export function ContactDuplicates() {
  const [data, setData] = useState<{ candidates: Candidate[]; merges: Merge[] }>({ candidates: [], merges: [] });
  const [error, setError] = useState(""); const [busy, setBusy] = useState(true); const [version, setVersion] = useState(0);
  useEffect(() => { const c = new AbortController(); void fetch("/api/contacts/merge", { signal: c.signal }).then(async r => { const result = await r.json(); if (!r.ok) throw new Error(result.error); setData(result); setError(""); }).catch(e => { if (!c.signal.aborted) setError(e.message); }).finally(() => { if (!c.signal.aborted) setBusy(false); }); return () => c.abort(); }, [version]);
  const submit = async (body: object) => { const response = await fetch("/api/contacts/merge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); };
  const run = async (bodies: object[]) => { setBusy(true); setError(""); try { for (const body of bodies) await submit(body); } catch(e) { setError(e instanceof Error ? e.message : "Kunde inte spara."); } finally { setVersion(v => v + 1); } };
  return <section><h1>Sammanför kontakter</h1><p>Identiteter och historik samlas på ett kontaktkort. Ursprungliga kontaktuppgifter bevaras och sammanslagningen kan ångras.</p>
    {error && <p role="alert">{error}</p>}{busy && <p role="status">Arbetar…</p>}
    <button className="btn" disabled={busy} onClick={() => { setBusy(true); setVersion(v => v + 1); }}>Uppdatera förslag</button>{" "}
    <button className="btn primary" disabled={busy || !data.candidates.some(c => c.safe)} onClick={() => void run(data.candidates.filter(c => c.safe).map(c => ({ action: "merge", source: c.sourceId, target: c.targetId, automatic: true })))}>Sammanför säkra träffar automatiskt</button>
    {!busy && !error && !data.candidates.length && <p>Inga dubblettförslag hittades.</p>}
    {data.candidates.map(c => <article className="card" style={{ marginTop: 12 }} key={`${c.sourceId}:${c.targetId}`}><h2><Link prefetch={false} href={`/contacts/${c.sourceId}`}>{c.sourceName}</Link> → <Link prefetch={false} href={`/contacts/${c.targetId}`}>{c.targetName}</Link></h2><p>{c.reason}</p><button className="btn" disabled={busy} onClick={() => void run([{ action: "merge", source: c.sourceId, target: c.targetId, automatic: c.safe }])}>{c.safe ? "Sammanför" : "Bekräfta att detta är samma person"}</button></article>)}
    <h2>Tidigare sammanslagningar</h2>{data.merges.map(m => <article className="card" key={m.id}><p>{m.source_profile.display_name} · {new Date(m.created_at).toLocaleString("sv-SE")}</p><Link prefetch={false} href={`/contacts/${m.target_id}`}>Öppna samlat kontaktkort</Link> <button className="btn" disabled={busy} onClick={() => void run([{ action: "undo", id: m.id }])}>Ångra sammanslagning</button></article>)}
  </section>;
}
