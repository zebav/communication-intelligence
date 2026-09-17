import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/app/globals.css";
import "../src/components/assistant-workspace.css";
if (location.hostname !== "127.0.0.1") throw new Error("Local test only");
function Lab() {
  const [approval, setApproval] = useState<{ id: string; targetUrl: string; expiresAt: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const lock = useRef(false);
  async function act(action: "prepare" | "run") {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/__browser_lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, approvalId: approval?.id, confirmed }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (action === "prepare") { setApproval(data.approval); setConfirmed(false); setResult(null); }
      else { if (data.result.status !== "read" || typeof data.result.text !== "string") throw new Error("Testläsningen misslyckades. Kontrollera testservern innan ett nytt test förbereds."); setResult(data.result.text); setConfirmed(false); }
    } catch (e) { setError(e instanceof Error ? e.message : "Testet misslyckades."); }
    finally { setBusy(false); lock.current = false; }
  }
  return <main className="assistant-workspace" style={{ maxWidth: 760, padding: 24 }}>
    <h1>Testa godkännandeflödet</h1>
    <p className="assistant-notice"><strong>ISOLERAT TEST — INTE SKARP KÖRNING</strong><br />Syntetiskt konto och testunderlag. Ingen Browserbase-session, AI, inloggning eller extern webbplats används. Data försvinner när testservern startas om.</p>
    <ol><li>Förbered en testuppgift.</li><li>Granska adress och omfattning.</li><li>Godkänn en enda läsning.</li><li>Granska resultatet — inget markeras som utfört åt dig.</li></ol>
    <button className="btn" disabled={busy} onClick={() => act("prepare")}>Förbered nytt test</button>
    {approval && <section className="assistant-browser-status"><h2>Granska testuppgiften</h2><p>Endast läsning av detta syntetiska underlag:</p><p style={{ overflowWrap: "anywhere" }}>{approval.targetUrl}</p><p>Gäller till {new Date(approval.expiresAt).toLocaleTimeString("sv-SE")}.</p><p>Inga formulär, köp eller utskick tillåts.</p>
      <label style={{ display: "block", margin: "20px 0" }}><input type="checkbox" checked={confirmed} disabled={busy || result !== null} onChange={e => setConfirmed(e.target.checked)} /> Jag godkänner denna testläsning en gång.</label>
      <button className="btn primary" disabled={busy || !confirmed || result !== null} onClick={() => act("run")}>{busy ? "Kontrollerar…" : "Godkänn och kör test"}</button>
    </section>}
    {error && <p role="alert" className="assistant-alert">{error}</p>}
    {result !== null && <section aria-label="Testresultat"><h2>Läsresultat för granskning</h2><p role="status">Testkedjan slutförd. Ingen extern åtgärd har utförts.</p><pre className="assistant-browser-result">{result}</pre><p>Engångsgodkännandet är förbrukat. Uppgiften är inte markerad som genomförd.</p></section>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Lab />);
