"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Item = { id: string; source: string; body: string; sentAt: string; title: string; personId: string; person: string; account: string; status: string; reply: string };
const labels: Record<string, string> = { sent: "Skickat", delivered: "Levererat", read: "Läst", pending: "Väntar på sändning", failed: "Misslyckat" };
export function SentMessages({ accounts }: { accounts: { id: string; name: string }[] }) {
  const [filters, setFilters] = useState({ person: "", source: "", account: "", from: "", to: "" });
  const [page, setPage] = useState(0); const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ items: Item[]; more: boolean; loading: boolean; error: string }>({ items: [], more: false, loading: true, error: "" });
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState(s => ({ ...s, loading: true, error: "" }));
      try {
        const params = new URLSearchParams({ page: String(page), ...Object.fromEntries(Object.entries(filters).filter(([,v]) => v)) });
        const response = await fetch(`/api/sent?${params}`, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (!controller.signal.aborted) setState({ ...result, loading: false, error: "" });
      } catch (e) { if (!controller.signal.aborted) setState({ items: [], more: false, loading: false, error: e instanceof Error ? e.message : "Kunde inte hämta meddelanden." }); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [filters, page, retry]);
  const update = (key: keyof typeof filters, value: string) => { setPage(0); setFilters(f => ({ ...f, [key]: value })); };
  return <section><h1>Skickade meddelanden</h1><p>Importerade och skickade meddelanden från alla anslutna källor. Leveransstatus visas när tjänsten har rapporterat den.</p>
    <div className="person-facts" style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "20px 0" }}>
      <label>Person<input aria-label="Person" value={filters.person} onChange={e => update("person", e.target.value)} /></label>
      <label>Källa<select value={filters.source} onChange={e => update("source", e.target.value)}><option value="">Alla källor</option>{["email", "whatsapp", "instagram", "imessage", "messenger", "tinder", "linkedin", "tiktok", "manual"].map(s => <option key={s}>{s}</option>)}</select></label>
      <label>Konto<select value={filters.account} onChange={e => update("account", e.target.value)}><option value="">Alla konton</option>{accounts.map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label>
      <label>Från (UTC)<input type="date" value={filters.from} onChange={e => update("from", e.target.value)} /></label><label>Till (UTC)<input type="date" value={filters.to} onChange={e => update("to", e.target.value)} /></label>
    </div>
    {state.loading ? <p role="status">Hämtar skickade meddelanden…</p> : state.error ? <div role="alert">{state.error}<button onClick={() => setRetry(v => v + 1)}>Försök igen</button></div> : <>
      {!state.items.length && <p>Inga skickade meddelanden matchar filtren.</p>}
      {state.items.map(item => <article className="card" key={item.id} style={{ marginBottom: 12, overflowWrap: "anywhere" }}><h2>{item.personId ? <Link prefetch={false} href={`/contacts/${item.personId}`}>{item.person}</Link> : item.person}</h2><p>{item.source} · {item.account} · {new Date(item.sentAt).toLocaleString("sv-SE")}</p><p>{labels[item.status] ?? "Status okänd"} · {item.reply === "received" ? "Nytt inkommande meddelande i tråden" : item.reply === "waiting" ? "Väntar på svar" : item.reply === "not_required" ? "Inget svar behövs" : "Svar förväntas: okänt"}</p><button className="btn" onClick={async () => { try { const r = await fetch("/api/sent", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, expectsReply: item.reply !== "waiting" }) }); const result = await r.json(); if (!r.ok) throw new Error(result.error); setRetry(v => v + 1); } catch (e) { setState(s => ({ ...s, error: e instanceof Error ? e.message : "Kunde inte spara." })); } }}>{item.reply === "waiting" ? "Inget svar behövs" : "Markera: väntar på svar"}</button><strong>{item.title}</strong><details><summary>Visa meddelandet</summary><p style={{ whiteSpace: "pre-wrap" }}>{item.body}</p></details></article>)}
      <button className="btn" disabled={!page} onClick={() => setPage(p => p - 1)}>Föregående</button> <span>Sida {page + 1}</span> <button className="btn" disabled={!state.more} onClick={() => setPage(p => p + 1)}>Nästa</button>
    </>}
  </section>;
}
