"use client";

import { useRef, useState } from "react";

export function ContactPhotoEditor({ personId, name }: { personId: string; name: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState(0);
  const [hasPhoto, setHasPhoto] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const initials = name.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase() || "?";
  const upload = async (file: File) => {
    setBusy(true); setMessage("");
    const form = new FormData(); form.set("image", file);
    try {
      const response = await fetch(`/api/contacts/${personId}/photo`, { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Kontaktbilden kunde inte sparas.");
      setHasPhoto(true); setVersion(value => value + 1); setMessage("Kontaktbilden är sparad säkert.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Kontaktbilden kunde inte sparas."); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  return <section className="contact-photo-editor" aria-label="Kontaktbild">
    <div className="contact-photo-frame">{hasPhoto ? <img src={`/api/contacts/${personId}/photo?v=${version}`} alt={`Bild på ${name}`} onError={() => setHasPhoto(false)} /> : <span>{initials}</span>}</div>
    <div><strong>Kontaktbild</strong><p>Endast du kan se den. Bilden sparas krypterat i ditt privata valv.</p><input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); }} /><button className="btn" type="button" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Sparar…" : hasPhoto ? "Byt bild" : "Lägg till bild"}</button>{message && <small className={message.includes("sparad") ? "positive" : "negative"}>{message}</small>}</div>
  </section>;
}
