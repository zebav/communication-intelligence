"use client";

import { useEffect, useState } from "react";
import { CreditCard, ShieldCheck, Sparkles } from "lucide-react";

type Snapshot = {
  plan: { name: string; status: string; limits: { monthlyAiCredits: number; monthlyBrowserMinutes: number; connectedAccounts: number } };
  usage: { aiCredits: number; browserMinutes: number };
};

export function AccountPlan() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { void fetch("/api/account/plan", { cache: "no-store" }).then(async (response) => {
    const data = await response.json() as Snapshot & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Planen kunde inte hämtas.");
    setSnapshot(data);
  }).catch((caught) => setError(caught instanceof Error ? caught.message : "Planen kunde inte hämtas.")); }, []);

  if (error) return <div className="empty-card"><strong>Plan & usage är inte redo ännu</strong><p>{error} Dina meddelanden, kontakter och anslutningar påverkas inte.</p></div>;
  if (!snapshot) return <p className="subtitle">Hämtar plan och användning…</p>;
  const { plan, usage } = snapshot;
  return <section className="cards" aria-label="Plan och användning">
    <article className="card"><CreditCard size={17} /><h3>{plan.name}</h3><p>{plan.status === "active" ? "Kontot är aktivt." : `Kontostatus: ${plan.status}.`}</p><span className="pill">Betalning är inte aktiverad</span></article>
    <article className="card"><Sparkles size={17} /><h3>AI-användning</h3><p>{usage.aiCredits} av {plan.limits.monthlyAiCredits || "privat beta"} månadskrediter registrerade.</p><span className="pill">Serverstyrd mätning</span></article>
    <article className="card"><ShieldCheck size={17} /><h3>Webbuppgifter</h3><p>{usage.browserMinutes} av {plan.limits.monthlyBrowserMinutes || "privat beta"} minuter registrerade. Externa åtgärder kräver fortsatt godkännande.</p><span className="pill">MFA-skyddat</span></article>
  </section>;
}
