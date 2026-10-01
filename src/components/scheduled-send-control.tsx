"use client";
import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { ConversationMapsAssistant } from "@/components/conversation-maps-assistant";

type Timing = "now" | "within_3_hours" | "tomorrow_afternoon" | "in_3_days" | "no_reply_needed";
type Props = { conversationId: string; messageId: string; source: string; body: string; suggestedTiming?: Timing; suggestedTimingReason?: string; disabled?: boolean; onScheduled?: () => void };
function initialDate() { const value = new Date(Date.now() + 60 * 60_000); value.setMinutes(Math.ceil(value.getMinutes() / 5) * 5, 0, 0); return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
function suggestedDate(timing?: Timing) { const value = new Date(); if (timing === "within_3_hours") value.setHours(value.getHours() + 3); else if (timing === "tomorrow_afternoon") { value.setDate(value.getDate() + 1); value.setHours(14, 0, 0, 0); } else if (timing === "in_3_days") { value.setDate(value.getDate() + 3); value.setHours(10, 0, 0, 0); } else return null; return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
const timingLabels: Record<Timing, string> = { now: "Skicka nu", within_3_hours: "inom tre timmar", tomorrow_afternoon: "i morgon eftermiddag", in_3_days: "om tre dagar", no_reply_needed: "Inget svar behövs" };

/** Explicit scheduling approval for an already reviewed draft. */
export function ScheduledSendControl({ conversationId, messageId, source, body, suggestedTiming, suggestedTimingReason, disabled = false, onScheduled }: Props) {
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
  const suggested = suggestedDate(suggestedTiming);
  return <div className="scheduled-send-control">
    {open ? <div className="scheduled-send-picker">{suggested && suggestedTiming && <button className="btn" type="button" onClick={() => setWhen(suggested)}>Använd AI:s förslag: {timingLabels[suggestedTiming]}</button>}<label>Skicka senare<input aria-label="Tidpunkt för schemalagt utskick" type="datetime-local" value={when} min={initialDate()} onChange={(event) => setWhen(event.target.value)} /></label>{suggestedTimingReason && <small className="muted">AI:s bedömning: {suggestedTimingReason}</small>}<ConversationMapsAssistant /><div><button className="btn" type="button" disabled={saving} onClick={() => setOpen(false)}>Avbryt</button><button className="btn" type="button" disabled={saving || disabled || !when} onClick={() => void schedule()}>{saving ? "Planerar…" : "Planera exakt detta svar"}</button></div></div> : <button className="btn" type="button" disabled={disabled} onClick={() => { setOpen(true); if (suggested) setWhen(suggested); setNotice(""); }}><CalendarClock size={13} />{suggestedTiming && suggestedTiming !== "now" && suggestedTiming !== "no_reply_needed" ? `Skicka ${timingLabels[suggestedTiming]}` : "Skicka senare"}</button>}
    {notice && <p className={notice.startsWith("Planerat") ? "positive" : "negative"}>{notice}</p>}
  </div>;
}
