"use client";

import { MapPin, Search } from "lucide-react";
import { useState } from "react";

type Place = { id: string; name: string; address: string; mapsUrl: string };

/** A deliberate, bounded Maps lookup for a communication that involves a place. */
export function ConversationMapsAssistant({ initialQuery = "" }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [items, setItems] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const search = async () => {
    if (query.trim().length < 3) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/calendar/planning", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "places", query }) });
      const data = await response.json() as { places?: Place[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Platsen kunde inte sökas.");
      setItems(data.places ?? []); if (!(data.places ?? []).length) setMessage("Ingen tydlig plats hittades.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Platsen kunde inte sökas."); }
    finally { setBusy(false); }
  };
  return <section className="intel-section conversation-maps-assistant">
    <div className="reply-heading"><div><span>Plats och resa</span><small>Google Maps används bara när du söker</small></div><MapPin size={18} /></div>
    <p className="muted">För möten, middagar, resor och bokningar: kontrollera platsen här innan du gör en kalender- eller bokningsåtgärd.</p>
    <div className="toolbar"><input aria-label="Sök plats med Google Maps" value={query} maxLength={300} placeholder="Restaurang, hotell eller adress" onChange={(event) => setQuery(event.target.value)} /><button className="btn" type="button" disabled={busy || query.trim().length < 3} onClick={() => void search()}><Search size={13} />{busy ? "Söker…" : "Sök plats"}</button></div>
    {items.map((place) => <div className="person-fact" key={place.id}><strong>{place.name}</strong><span>{place.address}</span><a href={place.mapsUrl} target="_blank" rel="noreferrer">Öppna i Google Maps</a></div>)}
    {message && <p className="negative">{message}</p>}
  </section>;
}
