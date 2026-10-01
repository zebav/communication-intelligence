"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CirclePause, Cloud, Globe2, MapPin, MessageCircle, RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import type { ServicePermission, ServiceSnapshot } from "@/lib/services/catalog";

type Payload = { services: ServiceSnapshot[]; policiesUnavailable?: boolean; error?: string };
const labels: Record<ServicePermission, string> = { off: "Av", read: "Läsa", suggest: "Föreslå", prepare: "Förbereda" };
const statusCopy = { connected: "Ansluten", ready: "Klar", needs_setup: "Behöver anslutas", planned: "Förberedd", paused: "Pausad" } as const;
const iconFor = (category: ServiceSnapshot["category"]) => category === "Messages" ? MessageCircle : category === "Planning" ? MapPin : category === "Documents" ? Cloud : Globe2;

export function ServiceToolLayer() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const load = async () => {
    const response = await fetch("/api/services", { cache: "no-store" });
    const data = await response.json() as Payload;
    if (!response.ok) throw new Error(data.error ?? "Tjänsterna kunde inte läsas.");
    setPayload(data);
  };
  useEffect(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Tjänsterna kunde inte läsas.")); }, []);
  const update = async (service: ServiceSnapshot, enabled: boolean, permission = service.policy) => {
    setSaving(service.id); setError("");
    try {
      const response = await fetch("/api/services", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ serviceId: service.id, enabled, permission }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Inställningen kunde inte sparas.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Inställningen kunde inte sparas."); }
    finally { setSaving(null); }
  };
  if (error && !payload) return <div className="empty-card"><strong>Service & Tool Layer kunde inte laddas</strong><p>{error}</p><button className="btn" onClick={() => void load()}>Försök igen</button></div>;
  if (!payload) return <p className="subtitle">Hämtar tjänster och säkerhetsregler…</p>;
  const groups = ["Messages", "Planning", "Documents", "Web"] as const;
  return <section className="service-tool-layer">
    <div className="service-layer-head"><div><span className="eyebrow">Service & Tool Layer V1</span><h2>Trygga resurser för assistenten</h2><p>Varje tjänst har ett tydligt syfte, minsta möjliga behörighet och ett stopp före externa åtgärder. Att slå på en tjänst ger aldrig AI fria händer.</p></div><ShieldCheck size={24} /></div>
    {payload.policiesUnavailable && <div className="empty-card"><strong>Inställningslagringen behöver installeras</strong><p>Tjänsterna kan visas redan nu, men paus och behörighetsnivå kan sparas först efter databasinstallationen.</p></div>}
    {error && <p className="assistant-alert" role="alert">{error}</p>}
    {groups.map((group) => <section className="service-group" key={group}><h3>{group}</h3><div className="service-grid">{payload.services.filter((service) => service.category === group).map((service) => {
      const Icon = iconFor(service.category); const isSaving = saving === service.id;
      const canConnectSlack = service.id === "slack" && (service.status === "ready" || service.status === "needs_setup");
      return <article className="card service-card" key={service.id}><div className="service-card-head"><span className="avatar"><Icon size={15} /></span><div><strong>{service.name}</strong><small>{statusCopy[service.status]}{service.accountLabel ? ` · ${service.accountLabel}` : ""}</small></div><span className={`pill service-status ${service.status}`}><CheckCircle2 size={11} />{statusCopy[service.status]}</span></div><p>{service.purpose}</p><div className="service-capabilities">{service.capabilities.map((capability) => <span key={capability}>{capability}</span>)}</div>{service.lastSyncAt && <small className="muted">Senast lyckade import: {new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(service.lastSyncAt))}</small>}{service.setupNote && <small className="muted">{service.setupNote}</small>}{service.requiresReconnect && <p className="assistant-alert">Slack behöver auktoriseras om för att läsa dina egna meddelanden.</p>}{canConnectSlack && <a className="btn" href="/api/connectors/slack/start">{service.requiresReconnect ? "Återanslut Slack" : "Anslut Slack"}</a>}<div className="service-policy"><label>Assistenten får</label><select aria-label={`${service.name} behörighetsnivå`} value={service.policy} disabled={isSaving || !service.available} onChange={(event) => void update(service, service.status !== "paused", event.target.value as ServicePermission)}>{(["off", "read", "suggest", "prepare"] as ServicePermission[]).filter((permission) => permission === "off" || (["off", "read", "suggest", "prepare"].indexOf(permission) <= ["off", "read", "suggest", "prepare"].indexOf(service.maxPermission))).map((permission) => <option value={permission} key={permission}>{labels[permission]}</option>)}</select><button className="btn" disabled={isSaving || !service.available} onClick={() => void update(service, service.status === "paused")}>{isSaving ? <RefreshCw size={12} className="spin" /> : <CirclePause size={12} />}{service.status === "paused" ? "Återuppta" : "Pausa"}</button></div><small className="muted"><Wrench size={11} /> Externa ändringar kräver ett separat, tydligt godkännande.</small></article>;
    })}</div></section>)}
  </section>;
}
