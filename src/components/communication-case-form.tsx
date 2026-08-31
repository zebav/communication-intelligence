"use client";

import { useActionState, useEffect, useRef } from "react";
import { LoaderCircle, Plus } from "lucide-react";
import { createCommunicationCase } from "@/app/cases/actions";

export function CommunicationCaseForm() {
  const [state, formAction, pending] = useActionState(createCommunicationCase, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.success) formRef.current?.reset(); }, [state]);

  return <form ref={formRef} action={formAction} className="case-form">
    <div className="case-form-grid">
      <label>Person<input name="personName" required maxLength={120} placeholder="Name of the person" /></label>
      <label>Subject<input name="title" required maxLength={200} placeholder="What is this about?" /></label>
      <label>Source<select name="source" defaultValue="manual"><option value="manual">Manual</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option><option value="messenger">Messenger</option><option value="linkedin">LinkedIn</option><option value="tiktok">TikTok</option><option value="tinder">Tinder</option></select></label>
    </div>
    <label>Communication<textarea name="message" required maxLength={20000} placeholder="Paste or write the received message here…" /></label>
    <div className="case-form-footer"><div aria-live="polite">{state?.error && <span className="form-message error">{state.error}</span>}{state?.success && <span className="form-message success">{state.success}</span>}</div><button className="btn primary" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={13} /> : <Plus size={13} />} {pending ? "Saving…" : "Save case"}</button></div>
  </form>;
}
