"use client";

import { useState } from "react";
import { BookUser, RefreshCw, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ChannelConnection } from "@/lib/domain";

/** Provider books enrich the existing Person Graph. They never form a separate contact area. */
export function ContactAddressBookSync({ connections }: { connections: ChannelConnection[] }) {
  const router = useRouter();
  const accounts = connections.filter((connection) => connection.status === "connected" && (connection.provider === "gmail" || connection.provider === "microsoft-graph"));
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const sync = async (connection: ChannelConnection) => {
    setBusy(connection.id); setMessage(""); setError("");
    try {
      const response = await fetch("/api/contacts/sync-address-book", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ connectionId: connection.id }) });
      const result = await response.json() as { fetched?: number; created?: number; linked?: number; conflicts?: number; error?: string; reconnectRequired?: boolean };
      if (!response.ok) throw new Error(result.error ?? "Kontakterna kunde inte synkroniseras.");
      setMessage(`${connection.accountName || connection.accountIdentifier || "Kontot"}: ${result.fetched ?? 0} kontakter kontrollerade · ${result.created ?? 0} nya kontakter · ${result.linked ?? 0} säkra kopplingar${result.conflicts ? ` · ${result.conflicts} behöver granskas` : ""}.`);
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Kontakterna kunde inte synkroniseras."); }
    finally { setBusy(""); }
  };
  if (!accounts.length) return null;
  return <section className="card" aria-label="Synkronisera kontaktböcker">
    <BookUser size={18} /><h3>Synkronisera kontaktböcker</h3>
    <p>Google- och Microsoft-kontakter läggs i dina befintliga Contacts. Endast exakt e-postadress eller telefonnummer kopplas automatiskt; namn räcker aldrig för en sammanslagning.</p>
    <div className="connector-actions">{accounts.map(account => <button key={account.id} className="btn" disabled={Boolean(busy)} onClick={() => void sync(account)}><RefreshCw size={14} />{busy === account.id ? "Synkroniserar…" : `Synka ${account.accountName || account.accountIdentifier || (account.provider === "gmail" ? "Google" : "Microsoft")}`}</button>)}</div>
    <small><ShieldCheck size={12} /> Kontakterna läses bara från leverantören; inga externa kontakter ändras.</small>
    {message && <p className="positive">{message}</p>}{error && <p className="negative">{error}</p>}
  </section>;
}
