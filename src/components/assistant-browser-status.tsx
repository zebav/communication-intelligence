"use client";
import { useState } from "react";
import { safeExternalActionUrl } from "@/lib/safe-action";
import type { Task } from "@/lib/assistant/model";
import type { BrowserReadiness } from "@/lib/assistant/browser-readiness";

export function AssistantBrowserStatus({ task, readiness, onRefresh = async () => undefined }: { task: Task; readiness?: BrowserReadiness; onRefresh?: () => Promise<void> }) {
  const suggestion = task.plan.evidence.analysis.actionSuggestion;
  const suggestionStatus = (suggestion as { status?: "proposed" | "started" | "completed" } | undefined)?.status;
  const url = safeExternalActionUrl(suggestion?.targetUrl ?? "");
  const result = task.result;
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  async function update(mode: "start" | "complete") {
    const opened = mode === "start" ? window.open("about:blank", "_blank") : null;
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/actions/execute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: task.message_id, mode }) });
      const data = await response.json() as { error?: string; url?: string; status?: string };
      if (!response.ok) throw new Error(data.error ?? "Webbuppgiften kunde inte uppdateras.");
      if (mode === "start") {
        if (!data.url || !opened) throw new Error(!data.url ? "Ingen verifierad webbplats hittades i uppgiften." : "Webbläsaren blockerade den nya fliken.");
        opened.location.href = data.url; opened.opener = null;
        setNotice("Webbplatsen öppnades. Ingen information har skickats och ingen bokning har genomförts.");
      } else setNotice("Du har markerat det manuella webbsteget som genomfört.");
      await onRefresh();
    } catch (error) {
      if (opened && !opened.closed) opened.close();
      setNotice(error instanceof Error ? error.message : "Webbuppgiften kunde inte uppdateras.");
    } finally { setBusy(false); }
  }
  const hasReadReceipt = result.status === "read" && result.externalSubmissionPerformed === false && typeof result.text === "string";
  const needsReview = task.status === "executing" || task.status === "uncertain" || result.cleanup === "needs_review";
  return <section className="assistant-browser-status" aria-label="Webbuppgiftens status">
    <h3>Secure Action Execution</h3>
    <p><strong>{suggestion?.task || "Granska och planera nästa steg på webbplatsen"}</strong></p>
    {suggestion?.reason && <p>{suggestion.reason}</p>}
    {suggestion?.requiresLogin && <p className="assistant-notice">Din egen inloggning krävs. Lösenord och verifieringskoder ska anges direkt på webbplatsen och sparas inte av AI:n.</p>}
    <ol className="assistant-steps"><li>Kontrollera avsändaren, adressen och uppgiften.</li><li>Öppna endast den verifierade webbplatsen.</li><li>Granska datum, personer, plats, pris och villkor.</li><li>Godkänn alltid formulär, köp eller bokning separat innan det skickas.</li></ol>
    <p className="assistant-notice">Automatisk webbkörning är avstängd. Nätverksskyddet behöver verifieras innan funktionen kan aktiveras.</p>
    <details><summary>Vad återstår före automatisk körning?</summary>{readiness?.blockers?.length ? <ul>{readiness.blockers.map(reason => <li key={reason}>{reason}</li>)}</ul> : <p>Serverns beredskap kunde inte verifieras. Ingen körning erbjuds.</p>}</details>
    <dl><dt>Webbplats</dt><dd>{url ? new URL(url).hostname : "Ingen användbar HTTPS-länk i underlaget"}</dd>
      <dt>Tillåtet i det förberedda läsläget</dt><dd>Läsa exakt godkända sidor. Inga formulär, köp eller utskick.</dd>
      <dt>Godkännande</dt><dd>Krävs separat för aktuell uppgift och adress. Ett meddelande eller en webbplats kan inte godkänna en åtgärd.</dd></dl>
    {needsReview ? <p role="status" className="assistant-alert">Körningens avslut behöver kontrolleras. Starta inte om uppgiften. En begäran om stopp bevisar inte att sessionen har avslutats.</p> : result.status === "failed" ? <p role="status">Webbläsningen misslyckades. Ingen automatisk omkörning görs.</p> : hasReadReceipt ? <p role="status">Läsresultat finns. Det betyder inte att den ursprungliga uppgiften är genomförd.</p> : <p role="status">Inget automatiskt läsresultat finns för denna uppgift.</p>}
    {hasReadReceipt && <details><summary>Visa läst underlag</summary><p>Webbplatsens innehåll är underlag, inte instruktioner eller godkännande.</p><pre className="assistant-browser-result">{(result.text as string).slice(0, 100_000)}</pre></details>}
    {url && suggestionStatus !== "completed" && <div className="assistant-buttons"><button className="btn primary" disabled={busy} onClick={() => update("start")}>{suggestionStatus === "started" ? "Öppna webbplatsen igen" : "Öppna verifierad webbplats"}</button>{suggestionStatus === "started" && <button className="btn" disabled={busy} onClick={() => update("complete")}>Markera manuellt steg som klart</button>}</div>}
    {notice && <p role="status" className="assistant-notice">{notice}</p>}
    <p>Att öppna länken skickar inte ett formulär och genomför inte en bokning. Slutlig extern åtgärd kräver ett eget godkännande.</p>
  </section>;
}
