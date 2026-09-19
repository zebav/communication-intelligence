"use client";

import { useEffect, useMemo, useState } from "react";
import { KeyRound, Plus, ShieldCheck, Trash2 } from "lucide-react";

type Entry = {
  id: string;
  category: string;
  key: string;
  value: string;
  sensitivity: "standard" | "personal" | "sensitive" | "restricted";
  allowedUses: string[];
  verified: boolean;
  verifiedAt: string | null;
  expiresAt?: string | null;
};

const empty = { category: "profile", key: "", value: "", sensitivity: "personal" as const, allowedUses: "" };

export function PersonalKnowledgeVault() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const response = await fetch("/api/knowledge", { cache: "no-store" });
    const result = await response.json() as { entries?: Entry[]; error?: string };
    if (!response.ok) throw new Error(result.error ?? "Personal Context kunde inte hämtas.");
    setEntries(result.entries ?? []);
  };

  useEffect(() => { queueMicrotask(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Personal Context kunde inte hämtas.")); }); }, []);

  const grouped = useMemo(() => entries.reduce<Record<string, Entry[]>>((groups, entry) => {
    (groups[entry.category] ??= []).push(entry);
    return groups;
  }, {}), [entries]);

  const save = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: form.category,
          key: form.key,
          value: form.value,
          sensitivity: form.sensitivity,
          allowedUses: form.allowedUses.split(",").map((value) => value.trim()).filter(Boolean),
          verified: true,
          metadata: {},
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The entry could not be saved.");
      setForm(empty); setMessage("Verified knowledge saved."); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The entry could not be saved."); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this verified knowledge entry?")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/knowledge", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The entry could not be deleted.");
      setMessage("Knowledge entry deleted."); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The entry could not be deleted."); }
    finally { setBusy(false); }
  };

  return <div className="cards">
    <section className="card">
      <KeyRound size={18} />
      <h3>Lägg till verifierad information</h3>
      <p>Detta kompletterar din befintliga kommunikationsprofil med fakta om dig, exempelvis <code>home_address</code>, <code>mobile_phone</code>, <code>company_registration_number</code> eller <code>preferred_airport</code>.</p>
      <label>Category<input className="people-search" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="profile, home, company, travel…" /></label>
      <label>Key<input className="people-search" value={form.key} onChange={(event) => setForm({ ...form, key: event.target.value })} placeholder="home_address" /></label>
      <label>Value<textarea value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} placeholder="Verified value" /></label>
      <label>Sensitivity<select className="filter" value={form.sensitivity} onChange={(event) => setForm({ ...form, sensitivity: event.target.value as typeof form.sensitivity })}><option value="standard">Standard</option><option value="personal">Personal</option><option value="sensitive">Sensitive</option><option value="restricted">Restricted</option></select></label>
      <label>Allowed uses<input className="people-search" value={form.allowedUses} onChange={(event) => setForm({ ...form, allowedUses: event.target.value })} placeholder="forms, travel, contracts (comma separated)" /></label>
      <button className="btn primary" disabled={busy || !form.category.trim() || !form.key.trim()} onClick={() => void save()}><Plus size={14} /> {busy ? "Sparar…" : "Spara verifierad fakta"}</button>
      {message && <p className="positive">{message}</p>}{error && <p className="negative">{error}</p>}
    </section>
    <section className="card">
      <ShieldCheck size={18} />
      <h3>Din verifierade kontext</h3>
      <p>AI använder endast specifika uppgifter som behövs för en uppgift. Begränsade värden kräver alltid ett separat godkännande innan de får användas.</p>
      {entries.length === 0 ? <div className="empty-card">Ingen verifierad personlig kontext sparad ännu.</div> : Object.entries(grouped).map(([category, values]) => <div key={category}>
        <div className="section-title">{category}</div>
        <div className="list">{values.map((entry) => <div className="list-row" key={entry.id}>
          <div><ShieldCheck size={14} /></div>
          <div><strong>{entry.key}</strong><small>{entry.sensitivity} · {entry.allowedUses.length ? entry.allowedUses.join(", ") : "no use restriction set"}</small></div>
          <div><span style={{ whiteSpace: "pre-wrap" }}>{entry.value}</span></div>
          <div><button className="icon-button" aria-label={`Delete ${entry.key}`} disabled={busy} onClick={() => void remove(entry.id)}><Trash2 size={15} /></button></div>
        </div>)}</div>
      </div>)}
    </section>
  </div>;
}
