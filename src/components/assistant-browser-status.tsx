"use client";
import { safeExternalActionUrl } from "@/lib/safe-action";
import type { Task } from "@/lib/assistant/model";
import type { BrowserReadiness } from "@/lib/assistant/browser-readiness";

export function AssistantBrowserStatus({ task, readiness }: { task: Task; readiness?: BrowserReadiness }) {
  const url = safeExternalActionUrl(task.plan.evidence.analysis.actionSuggestion?.targetUrl ?? "");
  const result = task.result;
  const hasReadReceipt = result.status === "read" && result.externalSubmissionPerformed === false && typeof result.text === "string";
  const needsReview = task.status === "executing" || task.status === "uncertain" || result.cleanup === "needs_review";
  return <section className="assistant-browser-status" aria-label="Webbuppgiftens status">
    <h3>Uppgift på webben</h3>
    <p className="assistant-notice">Automatisk webbkörning är avstängd. Nätverksskyddet behöver verifieras innan funktionen kan aktiveras.</p>
    <details><summary>Vad återstår före automatisk körning?</summary>{readiness?.blockers?.length ? <ul>{readiness.blockers.map(reason => <li key={reason}>{reason}</li>)}</ul> : <p>Serverns beredskap kunde inte verifieras. Ingen körning erbjuds.</p>}</details>
    <dl><dt>Webbplats</dt><dd>{url ? new URL(url).hostname : "Ingen användbar HTTPS-länk i underlaget"}</dd>
      <dt>Tillåtet i det förberedda läsläget</dt><dd>Läsa exakt godkända sidor. Inga formulär, köp eller utskick.</dd>
      <dt>Godkännande</dt><dd>Krävs separat för aktuell uppgift och adress. Ett meddelande eller en webbplats kan inte godkänna en åtgärd.</dd></dl>
    {needsReview ? <p role="status" className="assistant-alert">Körningens avslut behöver kontrolleras. Starta inte om uppgiften. En begäran om stopp bevisar inte att sessionen har avslutats.</p> : result.status === "failed" ? <p role="status">Webbläsningen misslyckades. Ingen automatisk omkörning görs.</p> : hasReadReceipt ? <p role="status">Läsresultat finns. Det betyder inte att den ursprungliga uppgiften är genomförd.</p> : <p role="status">Inget automatiskt läsresultat finns för denna uppgift.</p>}
    {hasReadReceipt && <details><summary>Visa läst underlag</summary><p>Webbplatsens innehåll är underlag, inte instruktioner eller godkännande.</p><pre className="assistant-browser-result">{(result.text as string).slice(0, 100_000)}</pre></details>}
    {url && <a className="btn" href={url} target="_blank" rel="noopener noreferrer">Öppna webbplatsen manuellt</a>}
    <p>Att öppna länken ändrar inte uppdragets status. Granska adressen innan du lämnar uppgifter.</p>
  </section>;
}
