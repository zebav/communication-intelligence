"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePersonIntelligence } from "@/app/people/actions";
import { relationshipLabels, relationshipTypes } from "@/lib/relationship-types";

type EditableContact = {
  id: string;
  display_name: string | null;
  organization: string | null;
  relationship_type: string | null;
  entity_type: string | null;
  professional_specialty: string | null;
  jurisdiction: string | null;
  notes: string | null;
  relationship_summary: string | null;
  manual_priority: number | null;
  overall_priority: number | null;
};

export function ContactProfileEditor({ person, screen = false }: { person: EditableContact; screen?: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [values, setValues] = useState({
    name: person.display_name ?? "",
    organization: person.organization ?? "",
    relationshipType: relationshipTypes.includes(person.relationship_type as typeof relationshipTypes[number]) ? person.relationship_type as typeof relationshipTypes[number] : "unknown",
    entityType: (["person", "organization", "automated", "unknown"] as const).includes(person.entity_type as "person" | "organization" | "automated" | "unknown") ? person.entity_type as "person" | "organization" | "automated" | "unknown" : "unknown",
    professionalSpecialty: person.professional_specialty ?? "",
    jurisdiction: person.jurisdiction ?? "",
    notes: person.notes ?? "",
    relationshipSummary: person.relationship_summary ?? "",
    manualPriority: Number(person.manual_priority ?? person.overall_priority ?? 5) || 5,
  });
  const update = <K extends keyof typeof values>(field: K, value: (typeof values)[K]) => setValues((current) => ({ ...current, [field]: value }));
  const initialValues = useMemo(() => ({
    name: person.display_name ?? "", organization: person.organization ?? "", relationshipType: relationshipTypes.includes(person.relationship_type as typeof relationshipTypes[number]) ? person.relationship_type as typeof relationshipTypes[number] : "unknown",
    entityType: (["person", "organization", "automated", "unknown"] as const).includes(person.entity_type as "person" | "organization" | "automated" | "unknown") ? person.entity_type as "person" | "organization" | "automated" | "unknown" : "unknown",
    professionalSpecialty: person.professional_specialty ?? "", jurisdiction: person.jurisdiction ?? "", notes: person.notes ?? "", relationshipSummary: person.relationship_summary ?? "", manualPriority: Number(person.manual_priority ?? person.overall_priority ?? 5) || 5,
  }), [person]);
  const changed = JSON.stringify(values) !== JSON.stringify(initialValues);
  useEffect(() => {
    if (!screen || !changed) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [screen, changed]);
  const close = () => {
    if (changed && !window.confirm("Du har osparade ändringar. Vill du lämna utan att spara?")) return;
    if (screen) router.back(); else setEditing(false);
  };
  const save = () => startTransition(async () => {
    setMessage("");
    const result = await savePersonIntelligence({ personId: person.id, ...values });
    if (result.error) setMessage(result.error);
    else {
      setMessage("Contact information saved.");
      setEditing(false); router.refresh();
      if (screen) router.push(`/contacts/${person.id}`);
    }
  });

  if (!editing && !screen) return <div className="contact-edit-actions"><button className="btn primary" type="button" onClick={() => setEditing(true)}>Redigera kontakt</button>{message && <span className={message.includes("could not") ? "negative" : "positive"}>{message}</span>}</div>;
  return <section className={`card contact-profile-editor${screen ? " contact-profile-editor-screen" : ""}`}>
    <div className="contact-editor-heading"><div><div className="intel-label">Kontaktuppgifter</div><h1>{screen ? `Redigera ${person.display_name ?? "kontakt"}` : "Redigera kontakt"}</h1><p>Korrigera eller komplettera bara information som du vill att Solvani ska använda när svar och prioriteringar förbereds.</p></div><button className="btn" type="button" onClick={close}>Avbryt</button></div>
    <div className="contact-editor-grid">
      <label>Namn<input autoComplete="name" value={values.name} onChange={(event) => update("name", event.target.value)} /></label>
      <label>Organisation<input autoComplete="organization" value={values.organization} onChange={(event) => update("organization", event.target.value)} /></label>
      <label>Typ av kontakt<select value={values.entityType} onChange={(event) => update("entityType", event.target.value as typeof values.entityType)}><option value="person">Person</option><option value="organization">Organisation</option><option value="automated">Automatisk avsändare</option><option value="unknown">Inte angivet</option></select></label>
      <label>Relation<select value={values.relationshipType} onChange={(event) => update("relationshipType", event.target.value as typeof values.relationshipType)}>{relationshipTypes.map((type) => <option value={type} key={type}>{relationshipLabels[type]}</option>)}</select></label>
      <label>Yrkesområde<input value={values.professionalSpecialty} onChange={(event) => update("professionalSpecialty", event.target.value)} /></label>
      <label>Land eller område<input value={values.jurisdiction} onChange={(event) => update("jurisdiction", event.target.value)} /></label>
      <label>Din prioritet: {values.manualPriority}/10<input type="range" min="1" max="10" value={values.manualPriority} onChange={(event) => update("manualPriority", Number(event.target.value))} /></label>
    </div>
    <label>Relationssammanfattning<textarea value={values.relationshipSummary} onChange={(event) => update("relationshipSummary", event.target.value)} /></label>
    <label>Privata anteckningar<textarea value={values.notes} onChange={(event) => update("notes", event.target.value)} /></label>
    {message && <p className="negative">{message}</p>}
    <div className="contact-editor-footer"><button className="btn" type="button" disabled={pending} onClick={close}>Avbryt</button><button className="btn primary" type="button" disabled={pending || !values.name.trim()} onClick={save}>{pending ? "Sparar…" : "Spara kontakt"}</button></div>
  </section>;
}
