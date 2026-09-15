"use client";

import Link from "next/link";

export function PersonLink({ personId, name }: { personId?: string; name: string }) {
  if (!personId) return <strong>{name}</strong>;
  return <Link prefetch={false} className="person-profile-link" href={`/contacts/${encodeURIComponent(personId)}`} onClick={(event) => event.stopPropagation()}><strong>{name}</strong></Link>;
}
