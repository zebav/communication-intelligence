"use client";

import Link from "next/link";
import { ContactAvatar } from "./contact-avatar";

export function PersonLink({ personId, name }: { personId?: string; name: string }) {
  if (!personId) return <span className="person-profile-inline"><ContactAvatar name={name} size={24} /><strong>{name}</strong></span>;
  return <Link prefetch={false} className="person-profile-link person-profile-inline" href={`/contacts/${encodeURIComponent(personId)}`} onClick={(event) => event.stopPropagation()}><ContactAvatar personId={personId} name={name} size={24} /><strong>{name}</strong></Link>;
}
