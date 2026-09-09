"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { FileUp, LoaderCircle } from "lucide-react";
import { importConversation } from "@/app/import/actions";
import { parseImportedConversation } from "@/lib/connectors/manual-import";

const channels = [["email", "Email / Gmail / Hotmail / Microsoft 365"], ["imessage", "iMessage"], ["linkedin", "LinkedIn"], ["tiktok", "TikTok"], ["instagram", "Instagram"], ["whatsapp", "WhatsApp"], ["messenger", "Messenger"], ["tinder", "Tinder"], ["manual", "Other"]] as const;

export function ConversationImportForm() {
  const [state, action, pending] = useActionState(importConversation, undefined);
  const [transcript, setTranscript] = useState("");
  const [fileError, setFileError] = useState("");
  const [image, setImage] = useState<File>();
  const [imageConsent, setImageConsent] = useState(false);
  const [readingImage, setReadingImage] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const messages = useMemo(() => parseImportedConversation(transcript), [transcript]);
  const readFile = async (file?: File) => {
    setFileError(""); if (!file) return;
    if (file.size > 500_000) return setFileError("Choose a text, CSV, or JSON export smaller than 500 KB.");
    if (!/\.(txt|csv|json)$/i.test(file.name)) return setFileError("This first version accepts .txt, .csv, and .json files.");
    setTranscript(await file.text());
  };
  const readScreenshot = async () => {
    if (!image || !imageConsent) return;
    setReadingImage(true); setFileError("");
    try {
      const form = new FormData(); form.set("image", image); form.set("consent", "yes");
      const response = await fetch("/api/import/screenshot", { method: "POST", body: form });
      const result = await response.json() as { transcript?: string; error?: string };
      if (!response.ok || !result.transcript) throw new Error(result.error ?? "The screenshot could not be read.");
      setTranscript(result.transcript);
    } catch (error) { setFileError(error instanceof Error ? error.message : "The screenshot could not be read."); }
    finally { setReadingImage(false); }
  };
  return <form action={action} className="case-form import-form">
    <div className="case-form-grid"><label>Channel<select name="source" defaultValue="imessage">{channels.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Which of your accounts?<input name="accountLabel" required maxLength={120} placeholder="Microsoft 365 — Company A" /></label><label>Other person<input name="participantName" required maxLength={120} placeholder="Name of the person" /></label><label>Your name in the export<input name="ownerName" required maxLength={120} defaultValue="Me" /></label><label>Conversation title<input name="title" required maxLength={200} placeholder="What is this about?" /></label></div>
    <div className="import-file"><input ref={fileRef} type="file" accept=".txt,.csv,.json,text/plain,text/csv,application/json" onChange={(event) => void readFile(event.target.files?.[0])} /><button type="button" className="btn" onClick={() => fileRef.current?.click()}><FileUp size={13} /> Choose exported file</button><span>or paste below</span></div>
    <div className="screenshot-import"><strong>Import from screenshot</strong><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setImage(event.target.files?.[0])} /><label className="import-confirm"><input type="checkbox" checked={imageConsent} onChange={(event) => setImageConsent(event.target.checked)} /> Send this image temporarily to OpenAI to extract visible text. The image is not saved by this app.</label><button type="button" className="btn" disabled={!image || !imageConsent || readingImage} onClick={() => void readScreenshot()}>{readingImage ? <LoaderCircle className="spin" size={13} /> : <FileUp size={13} />} {readingImage ? "Reading image…" : "Read screenshot"}</button></div>
    {fileError && <span className="form-message error">{fileError}</span>}
    <label>Conversation<textarea name="transcript" required maxLength={500000} value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder={'[2026-09-09 10:00] Anna: Hello\n[2026-09-09 10:02] Me: Hi Anna'} /></label>
    {messages.length > 0 && <div className="import-preview"><strong>Review before saving · {messages.length} message(s) found</strong>{messages.slice(0, 3).map((message, index) => <div key={index}><span>{message.sender}</span><p>{message.body}</p></div>)}{messages.length > 3 && <small>First 3 messages shown.</small>}</div>}
    <label className="import-confirm"><input type="checkbox" name="confirmed" value="yes" required /> I reviewed the channel, account, person, and message directions.</label>
    <div className="case-form-footer"><div aria-live="polite">{state?.error && <span className="form-message error">{state.error}</span>}{state?.success && <span className="form-message success">{state.success}</span>}</div><button className="btn primary" type="submit" disabled={pending || !transcript.trim()}>{pending ? <LoaderCircle className="spin" size={13} /> : <FileUp size={13} />} {pending ? "Importing…" : "Import reviewed conversation"}</button></div>
  </form>;
}
