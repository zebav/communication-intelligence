"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
type Contact = { id: string; display_name: string; organization: string | null };
export function ContactMergePicker({ personId, name }: { personId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<Contact | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open || query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/contacts/merge?q=" + encodeURIComponent(query), { signal: controller.signal });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setResults(data.contacts.filter((c: Contact) => c.id !== personId));
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Sökningen misslyckades."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, query, personId]);
  async function merge() {
    if (!selected || busy) return;
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/contacts/merge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "merge", source: selected.id, target: personId, automatic: false }) });
      const result = await r.json(); if (!r.ok) throw new Error(result.error);
      setOpen(false); setSelected(null); setResults([]); setQuery(""); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Kunde inte sammanföra."); }
    finally { setBusy(false); }
  }
  return <div className="intel-section"><button className="btn" onClick={() => setOpen(!open)} disabled={busy}>Sammanför kontakt</button>{open && <div>
    <p>Sök efter samma person på ett annat kontaktkort. Historiken samlas på {name}. Unika uppgifter bevaras och ändringen kan ångras under Kontakter → Sammanför kontakter.</p>
    <label>Sök namn<input value={query} onChange={e => { setQuery(e.target.value); setSelected(null); setResults([]); setError(""); }} placeholder="Minst två tecken…" /></label>
    {loading && <p role="status">Söker…</p>}{error && <p role="alert">{error}</p>}
    {results.map(c => <button className="btn" key={c.id} onClick={() => setSelected(c)} disabled={busy}>{c.display_name} {c.organization ? "· " + c.organization : ""}</button>)}
    {selected && <div className="send-confirm"><p>Sammanför {selected.display_name} med {name}? Bekräfta endast om det är samma person.</p><button className="btn primary" disabled={busy} onClick={() => void merge()}>{busy ? "Sammanför…" : "Bekräfta sammanslagning"}</button></div>}
  </div>}</div>;
}
