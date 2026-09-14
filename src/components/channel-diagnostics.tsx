"use client";

import { useState } from "react";
import { CheckCircle2, RefreshCw, Wrench } from "lucide-react";

type WhatsAppConnection = { id: string; label: string };
type HealthAccount = { id: string; account_name?: string | null; account_identifier?: string | null; live_delivery?: "subscribed" | "not_subscribed" | "unknown"; live_delivery_error?: string | null };
type HealthResponse = { accounts?: HealthAccount[]; configured?: Record<string, boolean>; error?: string };
type ReconcileResponse = { success?: boolean; checked?: number; createdPeople?: number; createdIdentities?: number; relinkedConversations?: number; relinkedMessages?: number; skipped?: number; error?: string };

export function ChannelDiagnostics({ whatsappConnections }: { whatsappConnections: WhatsAppConnection[] }) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState("");

  const checkHealth = async () => {
    setWorking("health"); setMessage("");
    try {
      const response = await fetch("/api/connectors/whatsapp/health", { cache: "no-store" });
      const result = await response.json() as HealthResponse;
      if (!response.ok) throw new Error(result.error ?? "WhatsApp health check failed.");
      setHealth(result);
    } catch (error) { setMessage(error instanceof Error ? error.message : "WhatsApp health check failed."); }
    finally { setWorking(""); }
  };

  const subscribe = async (connectionId: string) => {
    setWorking(connectionId); setMessage("");
    try {
      const response = await fetch("/api/connectors/whatsapp/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ connectionId }) });
      const result = await response.json() as { error?: string; subscribed?: boolean };
      if (!response.ok || !result.subscribed) throw new Error(result.error ?? "Live WhatsApp delivery could not be activated.");
      setMessage("WhatsApp live message delivery is subscribed. Send a new WhatsApp message and then refresh the app.");
      await checkHealth();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Live WhatsApp delivery could not be activated."); }
    finally { setWorking(""); }
  };

  const reconcile = async () => {
    setWorking("reconcile"); setMessage("");
    try {
      const response = await fetch("/api/contacts/reconcile-social", { method: "POST" });
      const result = await response.json() as ReconcileResponse;
      if (!response.ok) throw new Error(result.error ?? "Social contacts could not be reconciled.");
      setMessage(`Social contacts repaired: ${result.checked ?? 0} conversations checked, ${result.createdPeople ?? 0} people created, ${result.createdIdentities ?? 0} identities created, ${result.relinkedConversations ?? 0} conversations relinked and ${result.relinkedMessages ?? 0} messages relinked.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Social contacts could not be reconciled."); }
    finally { setWorking(""); }
  };

  return <div className="page" style={{ maxWidth: 900 }}>
    <span className="eyebrow">Channel diagnostics</span><h1>WhatsApp & social contacts</h1><p className="subtitle">Safe diagnostics for live message delivery and the Person graph. No message is sent and no external content is deleted.</p>
    {message && <div className="empty-card" style={{ marginTop: 16 }}>{message}</div>}

    <div className="section-title">WhatsApp live delivery</div>
    <div className="card">
      <p>Embedded Signup can connect an account without guaranteeing that the Meta app is subscribed to the WhatsApp Business Account webhook. Verify and repair that subscription here.</p>
      <div className="toolbar" style={{ marginTop: 12 }}><button className="btn" disabled={Boolean(working)} onClick={() => void checkHealth()}><RefreshCw size={12} /> {working === "health" ? "Checking…" : "Check live delivery"}</button></div>
      {health?.configured && <div className="person-stack" style={{ marginTop: 12 }}>{Object.entries(health.configured).map(([key, value]) => <div className="person-fact" key={key}><strong>{key}</strong><span>{value ? "Configured" : "Missing"}</span></div>)}</div>}
      {(health?.accounts ?? []).map((account) => <div className="learning-notice" key={account.id}><CheckCircle2 size={16} /><div><strong>{account.account_name || account.account_identifier || "WhatsApp account"}</strong><p>Live delivery: {account.live_delivery ?? "unknown"}{account.live_delivery_error ? ` · ${account.live_delivery_error}` : ""}</p>{account.live_delivery !== "subscribed" && <button className="btn primary" disabled={Boolean(working)} onClick={() => void subscribe(account.id)} style={{ marginTop: 9 }}><Wrench size={12} /> {working === account.id ? "Repairing…" : "Repair live delivery"}</button>}</div></div>)}
      {!whatsappConnections.length && <div className="empty-card">No connected WhatsApp account is visible to this user.</div>}
      {!health && whatsappConnections.map((connection) => <div className="learning-notice" key={connection.id}><div><strong>{connection.label}</strong><p>Run the health check to verify Meta webhook subscription.</p><button className="btn primary" disabled={Boolean(working)} onClick={() => void subscribe(connection.id)} style={{ marginTop: 9 }}><Wrench size={12} /> {working === connection.id ? "Repairing…" : "Repair live delivery"}</button></div></div>)}
    </div>

    <div className="section-title">Person graph repair</div>
    <div className="card"><p>Checks existing Instagram and WhatsApp conversations, ensures each sender has a Person + channel Identity, relinks orphaned conversations, and attaches inbound messages to the correct identity.</p><button className="btn primary" disabled={Boolean(working)} onClick={() => void reconcile()} style={{ marginTop: 12 }}><Wrench size={12} /> {working === "reconcile" ? "Repairing contacts…" : "Repair social contacts"}</button></div>
  </div>;
}
