"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

export function contactAvatarUrl(personId: string, revision?: string | number) {
  const suffix = revision === undefined ? "" : `?v=${encodeURIComponent(String(revision))}`;
  return `/api/contacts/${encodeURIComponent(personId)}/photo${suffix}`;
}

export function ContactAvatar({ personId, name, size = 28, revision }: { personId?: string; name: string; size?: number; revision?: string | number }) {
  const [failed, setFailed] = useState(false);
  const [localRevision, setLocalRevision] = useState(0);
  const initials = name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";
  const source = useMemo(() => personId ? contactAvatarUrl(personId, `${revision ?? "current"}-${localRevision}`) : "", [personId, revision, localRevision]);

  useEffect(() => {
    if (!personId) return;
    const refresh = (event: Event) => {
      if ((event as CustomEvent<{ personId?: string }>).detail?.personId === personId) {
        setFailed(false);
        setLocalRevision((value) => value + 1);
      }
    };
    window.addEventListener("solvani:avatar-updated", refresh);
    return () => window.removeEventListener("solvani:avatar-updated", refresh);
  }, [personId]);

  if (!personId || failed) return <span className="contact-avatar-fallback" style={{ width: size, height: size }} aria-hidden="true">{initials}</span>;
  return <span className="contact-avatar-wrap" style={{ width: size, height: size }}><Image src={source} alt="" width={size} height={size} unoptimized sizes={`${size}px`} onError={() => setFailed(true)} /></span>;
}
