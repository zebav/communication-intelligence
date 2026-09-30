"use client";
import { useState } from "react";
import { CalendarClock } from "lucide-react";

type Props = { conversationId: string; messageId: string; source: string; body: string; disabled?: boolean; onScheduled?: () => void };
function initialDate() { const value = new Date(Date.now() + 60 * 60_000); value.setMinutes(Math.ceil(value.getMinutes() / 5) * 5, 0, 0); return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }

/** Explicit scheduling approval for an already reviewed draft. */
export function ScheduledSendControl({ conversationId, messageId, source, body, disabled = false, onScheduled }: Props) {
  const [open, setOpen] = useState(false), [when, setWhen] = useState(initialDate), [saving, setSaving] = useState(false), [notice, setNotice] = useState("");
  if (!body.trim() || !["email", "instagram", "whatsapp"].includes(source)) return null;
  const schedule = async () => {
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/scheduled-messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId, messageId, body, scheduledFor: new Date(when).toISOString() }) });
      const data = await response.json() as { error?: string; item?: { scheduled_for: string } };
      if (!response.ok) throw new Error(data.error ?? "Kunde inte schemalägga utskicket.");
      const label = data.item?.scheduled_for ? new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.item.scheduled_for)) : "vald tid";
      setNotice(`Planerat till ${label}. Utskicket kontrolleras igen precis före sändning.`); setOpen(false); onScheduled?.();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Kunde inte schemalägga utskicket."); }
    finally { setSaving(false); }
  };
  return <div className="scheduled-send-control">
    {open ? <div className="scheduled-send-picker"><label>Skicka senare<input aria-label="Tidpunkt för schemalagt utskick" type="datetime-local" value={when} min={initialDate()} onChange={(event) => setWhen(event.target.value)} /></label><div><button className="btn" type="button" disabled={saving} onClick={() => setOpen(false)}>Avbryt</button><button className="btn" type="button" disabled={saving || disabled || !when} onClick={() => void schedule()}>{saving ? "Planerar…" : "Planera exakt detta svar"}</button></div></div> : <button className="btn" type="button" disabled={disabled} onClick={() => { setOpen(true); setNotice(""); }}><CalendarClock size={13} />Skicka senare</button>}
    {notice && <p className={notice.startsWith("Planerat") ? "positive" : "negative"}>{notice}</p>}
  </div>;
}
