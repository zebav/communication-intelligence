"use client";

import { useEffect, useRef, useState } from "react";
import { BookUser, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { accountDisplayLabel } from "@/lib/connectors/account-label";
import type { ChannelConnection } from "@/lib/domain";

const providerName = (provider: string) => provider === "gmail" ? "Google" : "Microsoft Outlook";
const reconnectPath = (provider: string) => provider === "gmail" ? "/api/connectors/google/start" : "/api/connectors/microsoft/start";

/** Provider books enrich Contacts; the secondary dialog keeps this out of the everyday workspace. */
export function ContactAddressBookSync({ connections }: { connections: ChannelConnection[] }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const accounts = connections.filter((connection) => connection.status === "connected" && (connection.provider === "gmail" || connection.provider === "microsoft-graph"));
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reconnectProvider, setReconnectProvider] = useState("");
  useEffect(() => () => { dialog.current?.close(); }, []);
  const open = () => { setMessage(""); setError(""); setReconnectProvider(""); dialog.current?.showModal(); };
  const sync = async (connection: ChannelConnection) => {
    setBusy(connection.id); setMessage(""); setError(""); setReconnectProvider("");
    try {
      const response = await fetch("/api/contacts/sync-address-book", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ connectionId: connection.id }) });
      const result = await response.json() as { fetched?: number; created?: number; linked?: number; conflicts?: number; error?: string; reconnectRequired?: boolean };
      if (!response.ok) { setReconnectProvider(result.reconnectRequired ? connection.provider : ""); throw new Error(result.error ?? "Kontakterna kunde inte synkroniseras."); }
      setMessage(`${accountDisplayLabel(connection)}: ${result.fetched ?? 0} kontakter kontrollerade · ${result.created ?? 0} nya · ${result.linked ?? 0} säkra kopplingar${result.conflicts ? ` · ${result.conflicts} behöver granskas` : ""}.`);
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Kontakterna kunde inte synkroniseras."); }
    finally { setBusy(""); }
  };
  if (!accounts.length) return null;
  return <>
    <div className="contact-sync-trigger"><span><BookUser size={15} /> Har du nya kontakter i Google eller Outlook?</span><button className="btn" onClick={open}>Importera kontaktbok</button></div>
    <dialog ref={dialog} className="contact-sync-dialog" aria-label="Importera kontakter från ett konto">
      <div className="contact-sync-dialog-head"><div><span className="eyebrow">Contacts</span><h2>Importera kontaktbok</h2><p>Välj vilket anslutet konto som ska läsas. Kontakter blir en del av din befintliga kontaktlista.</p></div><button className="icon-button" aria-label="Stäng" onClick={() => dialog.current?.close()}><X size={18} /></button></div>
      <div className="contact-sync-account-list">{accounts.map((account) => <article className="contact-sync-account" key={account.id}><div><strong>{providerName(account.provider)}</strong><span>{accountDisplayLabel(account)}</span><small>{account.lastSyncAt ? `Senast synkroniserad ${new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium" }).format(new Date(account.lastSyncAt))}` : "Kontaktbok har inte synkroniserats ännu"}</small></div><button className="btn primary" disabled={Boolean(busy)} onClick={() => void sync(account)}><RefreshCw className={busy === account.id ? "spin" : ""} size={14} />{busy === account.id ? "Synkroniserar…" : "Synkronisera"}</button></article>)}</div>
      <div className="contact-sync-safety"><ShieldCheck size={15} /><span>Endast exakta e-postadresser eller telefonnummer kopplas automatiskt. Namn räcker aldrig för att slå ihop två personer.</span></div>
      {message && <p className="positive">{message}</p>}
      {error && <div className="contact-sync-error"><p className="negative">{error}</p>{reconnectProvider && <a className="btn" href={reconnectPath(reconnectProvider)}>Återanslut {providerName(reconnectProvider)} med kontaktbehörighet</a>}</div>}
    </dialog>
  </>;
}
