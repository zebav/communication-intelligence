"use client";

import { useState, useTransition } from "react";
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

export function ContactProfileEditor({ person }: { person: EditableContact }) {
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
  const save = () => startTransition(async () => {
    setMessage("");
    const result = await savePersonIntelligence({ personId: person.id, ...values });
    if (result.error) setMessage(result.error);
    else {
      setMessage("Contact information saved.");
      setEditing(false);
      router.refresh();
    }
  });

  if (!editing) return <div className="contact-edit-actions"><button className="btn primary" type="button" onClick={() => setEditing(true)}>Edit contact</button>{message && <span className="positive">{message}</span>}</div>;
  return <section className="card contact-profile-editor">
    <div className="contact-editor-heading"><div><div className="intel-label">Edit contact</div><p>Correct or add information used by the AI when prioritizing and drafting replies.</p></div><button className="btn" type="button" onClick={() => setEditing(false)}>Cancel</button></div>
    <div className="contact-editor-grid">
      <label>Name<input value={values.name} onChange={(event) => update("name", event.target.value)} /></label>
      <label>Organization<input value={values.organization} onChange={(event) => update("organization", event.target.value)} /></label>
      <label>Contact type<select value={values.entityType} onChange={(event) => update("entityType", event.target.value as typeof values.entityType)}><option value="person">Person</option><option value="organization">Organization</option><option value="automated">Automated sender</option><option value="unknown">Unknown</option></select></label>
      <label>Relationship<select value={values.relationshipType} onChange={(event) => update("relationshipType", event.target.value as typeof values.relationshipType)}>{relationshipTypes.map((type) => <option value={type} key={type}>{relationshipLabels[type]}</option>)}</select></label>
      <label>Professional specialty<input value={values.professionalSpecialty} onChange={(event) => update("professionalSpecialty", event.target.value)} /></label>
      <label>Country or jurisdiction<input value={values.jurisdiction} onChange={(event) => update("jurisdiction", event.target.value)} /></label>
      <label>Priority: {values.manualPriority}<input type="range" min="1" max="10" value={values.manualPriority} onChange={(event) => update("manualPriority", Number(event.target.value))} /></label>
    </div>
    <label>Relationship summary<textarea value={values.relationshipSummary} onChange={(event) => update("relationshipSummary", event.target.value)} /></label>
    <label>Notes<textarea value={values.notes} onChange={(event) => update("notes", event.target.value)} /></label>
    {message && <p className="negative">{message}</p>}
    <button className="btn primary" type="button" disabled={pending || !values.name.trim()} onClick={save}>{pending ? "Saving…" : "Save contact"}</button>
  </section>;
}
