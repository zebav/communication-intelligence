"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CheckCircle2, Clipboard, FileText, FileUp, Image as ImageIcon, LoaderCircle, Sparkles } from "lucide-react";
import { importConversation } from "@/app/import/actions";
import type { ImportedConversationAnalysis } from "@/lib/connectors/import-analysis";

async function normalizeMobileImage(file: File) {
  const supported = new Set(["image/png", "image/jpeg", "image/webp"]);
  if (supported.has(file.type) && file.size <= 8_000_000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas_unavailable");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) throw new Error("conversion_failed");
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "conversation"}.jpg`, { type: "image/jpeg" });
  } catch {
    throw new Error("The iPhone image could not be converted. Save it as a screenshot or JPEG and try again.");
  }
}

export function ConversationImportForm() {
  const [state, action, pending] = useActionState(importConversation, undefined);
  const [raw, setRaw] = useState(""); const [analysis, setAnalysis] = useState<ImportedConversationAnalysis>();
  const [working, setWorking] = useState(false); const [error, setError] = useState(""); const [copied, setCopied] = useState(false);
  const textFile = useRef<HTMLInputElement>(null); const imageFile = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null); const autoSave = useRef(false);
  useEffect(() => { if (analysis && autoSave.current && !pending) { autoSave.current = false; requestAnimationFrame(() => formRef.current?.requestSubmit()); } }, [analysis, pending]);
  const acceptAnalysis = (result: ImportedConversationAnalysis) => { setAnalysis(result); setRaw(result.transcript); };
  const analyzeText = async (text = raw) => { if (!text.trim()) return; setWorking(true); setError(""); setAnalysis(undefined); try { const response = await fetch("/api/import/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transcript: text }) }); const result = await response.json() as ImportedConversationAnalysis & { error?: string }; if (!response.ok) throw new Error(result.error); autoSave.current = true; acceptAnalysis(result); } catch (cause) { setError(cause instanceof Error ? cause.message : "The conversation could not be analyzed."); } finally { setWorking(false); } };
  const analyzeImage = async (file?: File) => { if (!file) return; setWorking(true); setError(""); setAnalysis(undefined); try { const upload = await normalizeMobileImage(file); const form = new FormData(); form.set("image", upload); form.set("consent", "yes"); const response = await fetch("/api/import/screenshot", { method: "POST", body: form }); const result = await response.json() as ImportedConversationAnalysis & { error?: string }; if (!response.ok) throw new Error(result.error); autoSave.current = true; acceptAnalysis(result); } catch (cause) { setError(cause instanceof Error ? cause.message : "The screenshot could not be analyzed."); } finally { setWorking(false); if (imageFile.current) imageFile.current.value = ""; } };
  const chooseTextFile = async (file?: File) => { if (!file) return; if (file.size > 500_000) return setError("Choose a TXT, CSV, or JSON file smaller than 500 KB."); const text = await file.text(); setRaw(text); await analyzeText(text); };
  const copyReply = async () => { if (!analysis?.draftResponse) return; await navigator.clipboard.writeText(analysis.draftResponse); setCopied(true); setTimeout(() => setCopied(false), 1800); };
  return <form ref={formRef} action={action} className="case-form import-form simple-import">
    <div className="import-choice"><input ref={textFile} hidden type="file" accept=".txt,.csv,.json,text/plain,text/csv,application/json" onChange={(event) => void chooseTextFile(event.target.files?.[0])} /><input ref={imageFile} hidden type="file" accept="image/*" onChange={(event) => void analyzeImage(event.target.files?.[0])} /><button type="button" className="import-choice-button" onClick={() => imageFile.current?.click()}><ImageIcon size={18} /><strong>Upload screenshot</strong><span>Analyzes and saves automatically</span></button><button type="button" className="import-choice-button" onClick={() => textFile.current?.click()}><FileText size={18} /><strong>Upload conversation</strong><span>TXT, CSV or JSON</span></button></div>
    <div className="import-divider"><span>or paste a conversation</span></div>
    <textarea className="simple-import-text" value={raw} onChange={(event) => { setRaw(event.target.value); setAnalysis(undefined); }} onPaste={(event) => { const text = event.clipboardData.getData("text"); if (text.trim()) setTimeout(() => void analyzeText(text), 0); }} placeholder="Paste the conversation here. The system will identify the platform, person, topic and your next reply." />
    {!analysis && <button type="button" className="btn primary analyze-import-button" onClick={() => void analyzeText()} disabled={working || !raw.trim()}>{working ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />} {working ? "Reading and analyzing…" : "Analyze conversation"}</button>}
    <p className="import-privacy">Analyzing sends the text or image temporarily to the configured OpenAI API. API storage is disabled and screenshots are not saved by the app.</p>{error && <div className="empty-card negative">{error}</div>}
    {analysis && <div className="import-analysis"><div className="import-detected"><span>{analysis.source}</span><span>{analysis.participantName}</span><span>{analysis.title}</span><span>Priority {analysis.priorityScore}/10</span></div><section><small>What this is about</small><p>{analysis.summary}</p></section><section><small>Likely intent</small><p>{analysis.intent}</p></section><section className="import-reply"><div><small>Suggested reply · {analysis.draftTone}</small><button type="button" className="btn" onClick={() => void copyReply()}>{copied ? <CheckCircle2 size={13} /> : <Clipboard size={13} />} {copied ? "Copied" : "Copy reply"}</button></div>{analysis.draftResponse ? <textarea value={analysis.draftResponse} onChange={(event) => setAnalysis({ ...analysis, draftResponse: event.target.value })} /> : <p>{analysis.recommendedAction}</p>}</section>
      <input type="hidden" name="source" value={analysis.source} /><input type="hidden" name="accountLabel" value={analysis.accountLabel} /><input type="hidden" name="participantName" value={analysis.participantName} /><input type="hidden" name="ownerName" value={analysis.ownerName} /><input type="hidden" name="title" value={analysis.title} /><input type="hidden" name="transcript" value={analysis.transcript} /><input type="hidden" name="summary" value={analysis.summary} /><input type="hidden" name="intent" value={analysis.intent} /><input type="hidden" name="priorityScore" value={analysis.priorityScore} /><input type="hidden" name="recommendedAction" value={analysis.recommendedAction} /><input type="hidden" name="draftResponse" value={analysis.draftResponse} /><input type="hidden" name="draftTone" value={analysis.draftTone} /><input type="hidden" name="confirmed" value="yes" />
      <input type="hidden" name="profileSuggestions" value={JSON.stringify(analysis.profileSuggestions)} />
      <div className="case-form-footer"><div aria-live="polite">{state?.error && <span className="form-message error">{state.error}</span>}{state?.success && <span className="form-message success">{state.success}</span>}</div>{!state?.success && <button className="btn primary" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={13} /> : <FileUp size={13} />} {pending ? "Saving…" : "Save conversation"}</button>}</div></div>}
  </form>;
}
