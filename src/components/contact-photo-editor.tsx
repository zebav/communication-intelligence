"use client";

import { useRef, useState } from "react";
import { ContactAvatar } from "@/components/contact-avatar";

export function ContactPhotoEditor({ personId, name, compact = false }: { personId: string; name: string; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const upload = async (file: File) => {
    setBusy(true); setMessage("");
    const form = new FormData(); form.set("image", file);
    try {
      const response = await fetch(`/api/contacts/${personId}/photo`, { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Kontaktbilden kunde inte sparas.");
      setVersion(value => value + 1);
      window.dispatchEvent(new CustomEvent("solvani:avatar-updated", { detail: { personId } }));
      setMessage("Kontaktbilden är sparad säkert.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Kontaktbilden kunde inte sparas."); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  return <section className={`contact-photo-editor${compact ? " compact" : ""}`} aria-label="Kontaktbild">
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
    <button className="contact-photo-frame contact-photo-trigger" type="button" disabled={busy} onClick={() => input.current?.click()} aria-label={`Ändra bild på ${name}`} title="Ändra bild"><ContactAvatar personId={personId} name={name} size={compact ? 62 : 96} revision={version} /><span className="contact-photo-edit-label">Ändra</span></button>
    {!compact && <div><strong>Kontaktbild</strong><p>Tryck på bilden för att lägga till eller byta. Endast du kan se den.</p><button className="btn" type="button" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Sparar…" : "Välj bild"}</button>{message && <small className={message.includes("sparad") ? "positive" : "negative"}>{message}</small>}</div>}
    {compact && message && <small className={message.includes("sparad") ? "positive" : "negative"}>{message}</small>}
  </section>;
}
