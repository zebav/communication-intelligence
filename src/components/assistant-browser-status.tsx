"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, LockKeyhole, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { safeExternalActionUrl } from "@/lib/safe-action";
import type { Task } from "@/lib/assistant/model";
import type { BrowserReadiness } from "@/lib/assistant/browser-readiness";

type Field = {
  key: string;
  label: string;
  kind: "text" | "email" | "phone" | "date" | "username" | "password" | "account_number" | "one_time_code" | "other";
  description: string;
  sensitivity: "personal" | "sensitive" | "restricted";
  persist: boolean;
  hasValue: boolean;
  source: "vault" | "missing";
};

type RunResult = {
  summary?: string;
  confirmation?: string;
  finalUrl?: string;
  submitted?: boolean;
  missingInformation?: Array<{ key: string; label: string }>;
  blockedReason?: string;
};

const terminal = new Set(["COMPLETED", "FAILED", "STOPPED", "TIMED_OUT"]);

export function AssistantBrowserStatus({ task, readiness, onRefresh = async () => undefined }: { task: Task; readiness?: BrowserReadiness; onRefresh?: () => Promise<void> }) {
  const suggestion = task.plan.evidence.analysis.actionSuggestion;
  const url = safeExternalActionUrl(suggestion?.targetUrl ?? "");
  const [fields, setFields] = useState<Field[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [busyField, setBusyField] = useState("");
  const [running, setRunning] = useState(false);
  const [runStatus, setRunStatus] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<RunResult>({
    summary: typeof task.result.browserSummary === "string" ? task.result.browserSummary : "",
    confirmation: typeof task.result.browserConfirmation === "string" ? task.result.browserConfirmation : "",
    finalUrl: typeof task.result.browserFinalUrl === "string" ? task.result.browserFinalUrl : "",
    submitted: task.result.browserSubmitted === true,
    blockedReason: typeof task.result.browserBlockedReason === "string" ? task.result.browserBlockedReason : "",
  });

  const loadFields = useCallback(async () => {
    const response = await fetch(`/api/assistant/browser-inputs?taskId=${encodeURIComponent(task.id)}`, { cache: "no-store" });
    const data = await response.json() as { fields?: Field[]; error?: string };
    if (!response.ok) throw new Error(data.error ?? "Privata uppgifter kunde inte hämtas.");
    setFields(data.fields ?? []);
  }, [task.id]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      void loadFields().catch((error) => {
        if (active) setNotice(error instanceof Error ? error.message : "Privata uppgifter kunde inte hämtas.");
      });
    });
    return () => { active = false; };
  }, [loadFields, task.revision]);

  const missingPersistent = useMemo(() => fields.filter((field) => field.persist && !field.hasValue), [fields]);
  const missingEphemeral = useMemo(() => fields.filter((field) => !field.persist && !(values[field.key] ?? "").trim()), [fields, values]);
  const readyForRun = missingPersistent.length === 0 && missingEphemeral.length === 0;

  async function saveField(field: Field) {
    const value = values[field.key]?.trim() ?? "";
    if (!value) return;
    setBusyField(field.key); setNotice("");
    try {
      const response = await fetch("/api/assistant/browser-inputs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: task.id, revision: task.revision, key: field.key, value }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Uppgiften kunde inte sparas.");
      setValues((current) => ({ ...current, [field.key]: "" }));
      setEditing((current) => ({ ...current, [field.key]: false }));
      await loadFields();
      setNotice(`${field.label} är sparad krypterat i Dina privata uppgifter.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Uppgiften kunde inte sparas.");
    } finally { setBusyField(""); }
  }

  async function pollRun() {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const response = await fetch(`/api/assistant/browser-run?taskId=${encodeURIComponent(task.id)}`, { cache: "no-store" });
      const data = await response.json() as { status?: string; taskStatus?: string; result?: RunResult; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Browserbase-status kunde inte läsas.");
      setRunStatus(data.status ?? "");
      if (data.result) setResult(data.result);
      if (terminal.has(data.status ?? "") || ["done", "waiting", "uncertain"].includes(data.taskStatus ?? "")) {
        await loadFields().catch(() => undefined);
        await onRefresh();
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }
    throw new Error("Browserbase-körningen fortsätter längre än väntat. Statusen kan hämtas igen utan att starta om uppgiften.");
  }

  async function run() {
    setRunning(true); setNotice(""); setResult({});
    try {
      const ephemeral = Object.fromEntries(fields.filter((field) => !field.persist).map((field) => [field.key, values[field.key] ?? ""]));
      const response = await fetch("/api/assistant/browser-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: task.id, revision: task.revision, approved: true, ephemeral }),
      });
      const data = await response.json() as { status?: string; error?: string; missingFields?: Field[] };
      if (!response.ok) {
        if (data.missingFields?.length) await loadFields().catch(() => undefined);
        throw new Error(data.error ?? "Browserbase-körningen kunde inte startas.");
      }
      setRunStatus(data.status ?? "PENDING");
      setNotice("Browserbase har tagit emot den exakt godkända webbuppgiften. Starta inte en andra körning medan den pågår.");
      await pollRun();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Webbuppgiften kunde inte köras.");
    } finally { setRunning(false); }
  }

  const active = running || task.status === "executing" || ["PENDING", "RUNNING", "PREPARING"].includes(runStatus);
  const completedSummary = result.confirmation || result.summary;
  return <section className="assistant-browser-status" aria-label="Webbuppgiftens status">
    <h3>Browserbase Action Agent</h3>
    <p><strong>{suggestion?.task || "Genomför den godkända webbuppgiften"}</strong></p>
    {suggestion?.reason && <p>{suggestion.reason}</p>}
    {url && <dl><dt>Godkänd startadress</dt><dd><a href={url} target="_blank" rel="noreferrer">{new URL(url).hostname}</a></dd></dl>}

    {!readiness?.enabled ? <div className="assistant-alert"><strong>Browserbase är inte redo i denna miljö.</strong>{readiness?.blockers?.length ? <ul>{readiness.blockers.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}</div> : <div className="assistant-notice"><ShieldCheck size={15} /> <strong>Managed Agent aktiv.</strong> Uppgiften, webbplatsen och privata variabler binds till detta beslut. Betalningar, juridiska signeringar, säkerhetsändringar och destruktiva kontoåtgärder blockeras.</div>}

    {fields.length > 0 && <section className="browser-private-fields"><h4><KeyRound size={15} /> Uppgifter som behövs</h4><p>Fyll i saknade uppgifter här. Stabil information sparas krypterat i <b>Dina privata uppgifter</b> och kan återanvändas nästa gång. Engångskoder sparas aldrig.</p>
      {fields.map((field) => {
        const showInput = !field.persist || !field.hasValue || editing[field.key];
        return <div className="browser-private-field" key={field.key}><div><strong>{field.label}</strong>{field.description && <small>{field.description}</small>}<small>{field.persist ? "Kan sparas för denna webbplats" : "Engångsuppgift · sparas inte"}</small></div>
          {field.persist && field.hasValue && !editing[field.key] ? <div className="assistant-buttons"><span className="pill"><LockKeyhole size={12} /> Sparad i Dina privata uppgifter</span><button className="btn" type="button" onClick={() => setEditing((current) => ({ ...current, [field.key]: true }))}>Ersätt</button></div> : null}
          {showInput && <div className="browser-private-input"><input
            type={field.kind === "password" || field.kind === "one_time_code" ? "password" : field.kind === "email" ? "email" : field.kind === "date" ? "date" : field.kind === "phone" ? "tel" : "text"}
            autoComplete={field.kind === "password" ? "current-password" : field.kind === "username" ? "username" : "off"}
            value={values[field.key] ?? ""}
            onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
            placeholder={field.kind === "password" ? "••••••••" : field.label}
            aria-label={field.label}
          />{field.persist && <button className="btn primary" type="button" disabled={busyField === field.key || !(values[field.key] ?? "").trim()} onClick={() => void saveField(field)}>{busyField === field.key ? "Sparar…" : "Spara skyddat"}</button>}</div>}
        </div>;
      })}
    </section>}

    {task.status === "uncertain" && <p role="status" className="assistant-alert">Resultatet är osäkert. Kör inte samma åtgärd igen förrän du har kontrollerat vad webbplatsen faktiskt gjorde.</p>}
    {completedSummary && <div className={task.status === "done" ? "assistant-notice" : "assistant-alert"}><strong>{task.status === "done" ? "Webbuppgiften är klar" : "Browserbase behöver ditt nästa beslut"}</strong><p>{completedSummary}</p>{result.blockedReason && <p>{result.blockedReason}</p>}</div>}
    {runStatus && <p role="status">Browserbase-status: <strong>{runStatus}</strong></p>}
    {notice && <p role="status" className="assistant-notice">{notice}</p>}

    {task.status !== "done" && task.status !== "uncertain" && url && <div className="assistant-buttons">
      <button className="btn primary" disabled={!readiness?.enabled || !readyForRun || active} onClick={() => void run()}><Play size={14} />{active ? "Browserbase arbetar…" : "Godkänn och kör webbuppgiften"}</button>
      {active && <button className="btn" type="button" disabled={running} onClick={() => void pollRun().catch((error) => setNotice(error instanceof Error ? error.message : "Status kunde inte hämtas."))}><RefreshCw size={14} /> Hämta status</button>}
      <a className="btn" href={url} target="_blank" rel="noreferrer">Öppna manuellt</a>
    </div>}
    {!readyForRun && <p className="muted">Fyll i och spara de saknade uppgifterna innan webbuppgiften kan köras.</p>}
  </section>;
}
