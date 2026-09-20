"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { KeyRound, Pencil, Plus, ShieldCheck, Trash2, X } from "lucide-react";

type Sensitivity = "standard" | "personal" | "sensitive" | "restricted";
type Entry = { id: string; category: string; key: string; value: string; sensitivity: Sensitivity; allowedUses: string[]; };
type Draft = { id?: string; category: string; key: string; value: string; sensitivity: Sensitivity; allowedUses: string; };

const groups = [
  { id: "identity", label: "Identitet & kontakt", fields: ["Fullständigt namn", "Telefonnummer", "Privat e-post", "Personnummer"] },
  { id: "home", label: "Adresser & hem", fields: ["Hemadress", "Fritidsboende", "Postadress"] },
  { id: "work", label: "Yrke & företag", fields: ["Yrke", "Företag", "Organisationsnummer", "Arbetsadress"] },
  { id: "relationships", label: "Familj & relationer", fields: ["Familjemedlem", "Nyckelrelation", "Nödkontakt"] },
  { id: "travel", label: "Resor & preferenser", fields: ["Passnummer", "Passets utgångsdatum", "Flygplats", "Resepreferens"] },
  { id: "documents", label: "Dokument & signaturer", fields: ["Signatur", "Dokumentuppgift", "Försäkringsuppgift"] },
];
const emptyDraft = (): Draft => ({ category: "identity", key: "", value: "", sensitivity: "personal", allowedUses: "" });
const readableCategory = (value: string) => groups.find((group) => group.id === value)?.label ?? value;

export function PersonalKnowledgeVault() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
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
  const grouped = useMemo(() => entries.reduce<Record<string, Entry[]>>((all, entry) => { (all[entry.category] ??= []).push(entry); return all; }, {}), [entries]);
  const open = (entry?: Entry) => { setMessage(""); setError(""); setDraft(entry ? { ...entry, allowedUses: entry.allowedUses.join(", ") } : emptyDraft()); dialog.current?.showModal(); };
  const save = async () => {
    if (!draft.key.trim() || !draft.value.trim()) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/knowledge", { method: draft.id ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...draft, allowedUses: draft.allowedUses.split(",").map((value) => value.trim()).filter(Boolean), verified: true, metadata: {} }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Uppgiften kunde inte sparas.");
      dialog.current?.close(); setMessage("Personlig information har sparats skyddat."); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Uppgiften kunde inte sparas."); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    if (!window.confirm("Ta bort den här personliga uppgiften?")) return;
    setBusy(true); setError("");
    try { const response = await fetch("/api/knowledge", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }); const result = await response.json() as { error?: string }; if (!response.ok) throw new Error(result.error ?? "Uppgiften kunde inte tas bort."); setMessage("Uppgiften har tagits bort."); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Uppgiften kunde inte tas bort."); }
    finally { setBusy(false); }
  };
  return <section className="personal-context" aria-label="Personal Context">
    <div className="personal-context-head"><div><span className="eyebrow">Personal Context</span><h2>Dina privata uppgifter</h2><p>Spara information som kan behövas för planering och godkända uppgifter. Varje uppgift är krypterad och kräver MFA för att läsas.</p></div><button className="btn primary" onClick={() => open()}><Plus size={14} /> Lägg till uppgift</button></div>
    <div className="personal-context-guide"><ShieldCheck size={17} /><div><strong>En profil, två nivåer</strong><p><b>Your shared foundation</b> ovan styr hur AI kommunicerar. Här sparar du detaljer som adresser, dokument och relationer — utan att skapa en konkurrerande profil eller visa dem för AI om de inte behövs för en godkänd uppgift.</p></div></div>
    {message && <p className="positive">{message}</p>}{error && <p className="negative">{error}</p>}
    {entries.length === 0 ? <div className="personal-context-empty"><KeyRound size={18} /><div><strong>Inga privata uppgifter ännu</strong><p>Börja till exempel med hemadress, företag, familjekontakter eller reseuppgifter.</p></div></div> : <div className="personal-context-groups">{Object.entries(grouped).map(([category, values]) => <section key={category} className="personal-context-group"><h3>{readableCategory(category)}</h3>{values.map((entry) => <div className="personal-context-row" key={entry.id}><div><strong>{entry.key}</strong><span>{entry.value}</span><small>{entry.sensitivity === "restricted" ? "Begränsad · separat godkännande" : entry.sensitivity === "sensitive" ? "Känslig" : "Privat"}{entry.allowedUses.length ? ` · ${entry.allowedUses.join(", ")}` : ""}</small></div><div><button className="icon-button" aria-label={`Redigera ${entry.key}`} disabled={busy} onClick={() => open(entry)}><Pencil size={15} /></button><button className="icon-button" aria-label={`Ta bort ${entry.key}`} disabled={busy} onClick={() => void remove(entry.id)}><Trash2 size={15} /></button></div></div>)}</section>)}</div>}
    <dialog ref={dialog} className="personal-context-dialog" aria-label="Spara personlig uppgift"><div className="personal-context-dialog-head"><div><span className="eyebrow">Skyddad uppgift</span><h2>{draft.id ? "Redigera uppgift" : "Lägg till uppgift"}</h2></div><button className="icon-button" aria-label="Stäng" onClick={() => dialog.current?.close()}><X size={18} /></button></div><div className="case-form"><label>Område<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{groups.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}</select></label><label>Typ av uppgift<select value={draft.key} onChange={(event) => setDraft({ ...draft, key: event.target.value })}><option value="">Välj eller skriv en egen nedan</option>{groups.find((group) => group.id === draft.category)?.fields.map((field) => <option key={field} value={field.toLowerCase().replaceAll(" ", "_")}>{field}</option>)}</select></label><label>Namn på uppgift<input value={draft.key} onChange={(event) => setDraft({ ...draft, key: event.target.value })} placeholder="Exempel: home_address eller passport_number" /></label><label>Information<textarea value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} placeholder="Skriv den verifierade uppgiften här" /></label><div className="profile-two"><label>Skyddsnivå<select value={draft.sensitivity} onChange={(event) => setDraft({ ...draft, sensitivity: event.target.value as Sensitivity })}><option value="personal">Privat</option><option value="sensitive">Känslig</option><option value="restricted">Begränsad — fråga alltid först</option><option value="standard">Standard</option></select></label><label>Får användas för<input value={draft.allowedUses} onChange={(event) => setDraft({ ...draft, allowedUses: event.target.value })} placeholder="Resor, formulär, avtal" /></label></div><div className="case-form-footer"><small>Uppgiften krypteras innan lagring.</small><button className="btn primary" disabled={busy || !draft.key.trim() || !draft.value.trim()} onClick={() => void save()}>{busy ? "Sparar…" : "Spara skyddat"}</button></div></div></dialog>
  </section>;
}
