"use client";

import { useState } from "react";
import { saveCommunicationPersona } from "@/app/persona/actions";
import type { CommunicationPersona } from "@/lib/domain";

export function PersonaForm({ initial }: { initial: CommunicationPersona }) {
  const [persona, setPersona] = useState(initial); const [saving, setSaving] = useState(false); const [message, setMessage] = useState("");
  const field = (key: keyof CommunicationPersona, value: string) => setPersona((current) => ({ ...current, [key]: value }));
  const save = async () => { setSaving(true); setMessage(""); const result = await saveCommunicationPersona(persona); setMessage(result.error ?? "Persona saved securely."); setSaving(false); };
  return <div className="case-form"><label>Who you are<textarea value={persona.identitySummary} onChange={(event) => field("identitySummary", event.target.value)} placeholder="Founder, consultant, parent… Include only context you want used in replies." /></label><label>Default tone<input value={persona.defaultTone} onChange={(event) => field("defaultTone", event.target.value)} placeholder="Direct, warm and calm" /></label><label>Preferred reply length<input value={persona.preferredLength} onChange={(event) => field("preferredLength", event.target.value)} placeholder="2–4 short sentences" /></label><label>Communication principles<textarea value={persona.principles} onChange={(event) => field("principles", event.target.value)} placeholder="What should replies always or never do?" /></label><label>Usual sign-off<input value={persona.signOff} onChange={(event) => field("signOff", event.target.value)} placeholder="Best, Zebastian" /></label><button className="btn primary" type="button" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save persona"}</button>{message && <p>{message}</p>}</div>;
}
