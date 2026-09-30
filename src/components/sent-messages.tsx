"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Item = { id: string; source: string; body: string; sentAt: string; title: string; personId: string; person: string; account: string; status: string; reply: string };
type ScheduledItem = { id: string; source: string; body: string; scheduledFor: string; status: string; error?: string | null; title: string; person: string };
const labels: Record<string, string> = { sent: "Skickat", delivered: "Levererat", read: "Läst", pending: "Väntar på sändning", failed: "Misslyckat" };
export function SentMessages({ accounts }: { accounts: { id: string; name: string }[] }) {
  const [filters, setFilters] = useState({ person: "", source: "", account: "", from: "", to: "" });
  const [selectedId, setSelectedId] = useState("");
  const [page, setPage] = useState(0); const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ items: Item[]; more: boolean; loading: boolean; error: string }>({ items: [], more: false, loading: true, error: "" });
  const [scheduled, setScheduled] = useState<{ items: ScheduledItem[]; loading: boolean; error: string }>({ items: [], loading: true, error: "" });
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
    }, filters.person ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [filters, page, retry]);
  useEffect(() => { const controller = new AbortController(); void fetch("/api/scheduled-messages", { signal: controller.signal }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); if (!controller.signal.aborted) setScheduled({ items: data.items ?? [], loading: false, error: "" }); }).catch(error => { if (!controller.signal.aborted) setScheduled({ items: [], loading: false, error: error instanceof Error ? error.message : "Kunde inte hämta planerade utskick." }); }); return () => controller.abort(); }, [retry]);
  const update = (key: keyof typeof filters, value: string) => { setPage(0); setFilters(f => ({ ...f, [key]: value })); };
  const selected = state.items.find(item => item.id === selectedId) ?? state.items[0];
  return <section className="sent-workspace"><h1>Skickade meddelanden</h1><p>Importerade och skickade meddelanden från alla anslutna källor. Leveransstatus visas när tjänsten har rapporterat den.</p>
    <section className="scheduled-messages" aria-label="Planerade utskick"><div className="section-title">Planerade utskick</div>{scheduled.loading ? <p className="muted">Hämtar planerade utskick…</p> : scheduled.error ? <p className="negative">{scheduled.error}</p> : scheduled.items.length === 0 ? <p className="muted">Inga planerade utskick.</p> : <div className="person-stack">{scheduled.items.map(item => <article className="person-fact" key={item.id}><strong>{item.person} · {item.title}</strong><span>{item.source} · {new Date(item.scheduledFor).toLocaleString("sv-SE")}</span><small>{item.status === "scheduled" ? "Väntar på sändning" : item.status === "processing" ? "Kontrolleras före sändning" : item.status === "needs_review" ? "Behöver granskas" : "Misslyckat"}{item.error ? ` · ${item.error}` : ""}</small>{item.status === "scheduled" && <button className="btn" onClick={async () => { try { const response = await fetch("/api/scheduled-messages", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, action: "cancel" }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setRetry(value => value + 1); } catch (error) { setScheduled(value => ({ ...value, error: error instanceof Error ? error.message : "Kunde inte avbryta utskicket." })); } }}>Avbryt utskick</button>}</article>)}</div>}</section>
    <div className="person-facts" style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "20px 0" }}>
      <label>Person<input aria-label="Person" value={filters.person} onChange={e => update("person", e.target.value)} /></label>
      <label>Källa<select value={filters.source} onChange={e => update("source", e.target.value)}><option value="">Alla källor</option>{["email", "whatsapp", "instagram", "imessage", "messenger", "tinder", "linkedin", "tiktok", "manual"].map(s => <option key={s}>{s}</option>)}</select></label>
      <label>Konto<select value={filters.account} onChange={e => update("account", e.target.value)}><option value="">Alla konton</option>{accounts.map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label>
      <label>Från (UTC)<input type="date" value={filters.from} onChange={e => update("from", e.target.value)} /></label><label>Till (UTC)<input type="date" value={filters.to} onChange={e => update("to", e.target.value)} /></label>
    </div>
    {state.loading ? <p role="status">Hämtar skickade meddelanden…</p> : state.error ? <div role="alert">{state.error}<button onClick={() => setRetry(v => v + 1)}>Försök igen</button></div> : <>
      {!state.items.length && <p>Inga skickade meddelanden matchar filtren.</p>}
      <div className="inbox sent-inbox">
        <section className="inbox-col" aria-label="Skickade meddelanden">
          {state.items.map(item => <button type="button" className={`conversation-row ${selected?.id === item.id ? "selected" : ""}`} key={item.id} onClick={() => setSelectedId(item.id)}>
            <span className="avatar">{item.person.slice(0, 2).toUpperCase()}</span><span><strong>{item.person}</strong><p>{item.title}</p><small>{item.source} · {item.account}</small></span><span className="row-meta">{new Date(item.sentAt).toLocaleDateString("sv-SE")}<br />{labels[item.status] ?? "Status okänd"}</span>
          </button>)}
        </section>
        <section className="sent-detail" aria-label="Valt skickat meddelande">{selected ? <>
          <h2>{selected.title}</h2><p>Till: {selected.personId ? <Link prefetch={false} href={`/contacts/${selected.personId}`}>{selected.person}</Link> : selected.person}</p>
          <p>{selected.source} · {selected.account} · {new Date(selected.sentAt).toLocaleString("sv-SE")}</p>
          <p>{labels[selected.status] ?? "Status okänd"} · {selected.reply === "received" ? "Nytt inkommande meddelande i tråden" : selected.reply === "waiting" ? "Väntar på svar" : selected.reply === "not_required" ? "Inget svar behövs" : "Svar förväntas: okänt"}</p>
          <button className="btn" onClick={async () => { try { const r = await fetch("/api/sent", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: selected.id, expectsReply: selected.reply !== "waiting" }) }); const result = await r.json(); if (!r.ok) throw new Error(result.error); setRetry(v => v + 1); } catch(e) { setState(s => ({ ...s, error: e instanceof Error ? e.message : "Kunde inte spara." })); } }}>{selected.reply === "waiting" ? "Inget svar behövs" : "Markera: väntar på svar"}</button>
          <div className="sent-body">{selected.body}</div>
        </> : <p>Välj ett meddelande i listan.</p>}</section>
      </div>
      <button className="btn" disabled={!page} onClick={() => setPage(p => p - 1)}>Föregående</button> <span>Sida {page + 1}</span> <button className="btn" disabled={!state.more} onClick={() => setPage(p => p + 1)}>Nästa</button>
    </>}
  </section>;
}
