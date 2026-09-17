"use client";
import { useState } from "react";
import type { Plan } from "@/lib/assistant/model";
import type { CalendarIntent } from "@/lib/calendar/ai-intent";
import { refreshBookingCalendars } from "@/lib/calendar/booking-preflight";
import { CalendarMeetingComposer } from "./calendar-meeting-composer";

export function AssistantMeeting({ plan, timezone, onDone }: { plan: Plan; timezone: string; onDone: () => Promise<void> }) {
  const [date, setDate] = useState(""), [duration, setDuration] = useState(60), [intent, setIntent] = useState<CalendarIntent | null>(null);
  const [slots, setSlots] = useState<{ start: string; end: string; bookable: boolean }[]>([]), [chosen, setChosen] = useState<{ start: string; end: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  async function post(path: string, body: Record<string, unknown>) {
    const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || "Planeringen misslyckades."); return data;
  }
  async function run(action: "analyze" | "suggest") {
    setBusy(true); setError(""); setChosen(null); setSlots([]);
    try {
      if (action === "analyze") {
        const data = await post("/api/calendar/intents", { action: "analyze", conversationId: plan.evidence.conversationId });
        const proposal = data.proposal.proposal as CalendarIntent;
        setIntent(proposal);
        if (proposal.operation === "propose") { setDate(proposal.date ?? ""); setDuration(proposal.durationMinutes ?? 60); }
        setNotice("Granska datum och önskemål. Ingen bokning har gjorts.");
      } else {
        await refreshBookingCalendars(setNotice);
        const r = await fetch("/api/calendar/planning", { cache: "no-store" }), rules = await r.json();
        if (!r.ok) throw new Error(rules.error);
        const data = await post("/api/calendar", { action: "suggest", date, duration, preparation: rules.rules.preparationMinutes, recovery: rules.rules.recoveryMinutes, physical: false });
        setSlots(data.slots); setNotice(data.slots.some((slot: { bookable: boolean }) => slot.bookable) ? "Tidsförslag med dina buffertar. Plats och eventuell resa kontrolleras i nästa steg." : "Inga bokningsbara tider hittades. Välj en annan dag eller kontrollera kalenderns avstämning.");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Planeringen misslyckades."); }
    finally { setBusy(false); }
  }
  const wall = (instant: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instant)).replace(" ", "T");
  return <section className="assistant-meeting"><h3>Från förfrågan till bokning</h3>
    <button className="btn" disabled={busy} onClick={() => run("analyze")}>Hämta mötesönskemål från konversationen</button>
    {intent && <div><p>{intent.summary}</p>{intent.locationText && <p>Föreslagen plats: {intent.locationText} – välj rätt träff i Maps nedan.</p>}<ul>{intent.questions.map(q => <li key={q}>{q}</li>)}</ul>{intent.operation !== "propose" && <p>Analysen föreslår ingen ny bokning. Hantera eventuell ändring i kalendern.</p>}</div>}
    <label>Granskat datum ({timezone})<input type="date" value={date} onChange={e => { setDate(e.target.value); setChosen(null); setSlots([]); }} /></label>
    <label>Möteslängd i minuter<input type="number" min={5} max={600} value={duration} onChange={e => { setDuration(Number(e.target.value)); setChosen(null); setSlots([]); }} /></label>
    <button className="btn" disabled={busy || !date || duration < 5 || duration > 600} onClick={() => run("suggest")}>Kontrollera kalendrar och föreslå tider</button>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="assistant-buttons">{slots.filter(s => s.bookable).slice(0, 8).map(s => <button className="btn" key={s.start} disabled={busy} onClick={() => setChosen(s)}>{wall(s.start).replace("T", " ")} – {wall(s.end).slice(11)}</button>)}</div>
    {chosen && <CalendarMeetingComposer key={chosen.start} timezone={timezone} expanded initialStart={wall(chosen.start)} initialEnd={wall(chosen.end)} initialTitle={plan.evidence.title} conversationId={plan.evidence.conversationId} onDone={onDone} />}
    <details><summary>Jag vill ange tid manuellt</summary><CalendarMeetingComposer timezone={timezone} expanded initialTitle={plan.evidence.title} conversationId={plan.evidence.conversationId} onDone={onDone} /></details>
  </section>;
}
