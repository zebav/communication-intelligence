"use client";

import Image from "next/image";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

export function contactAvatarUrl(personId: string, revision?: string | number) {
  const suffix = revision === undefined ? "" : `?v=${encodeURIComponent(String(revision))}`;
  return `/api/contacts/${encodeURIComponent(personId)}/photo${suffix}`;
}

function revisionStorageKey(personId: string) {
  return `solvani:avatar-revision:${personId}`;
}

function storedRevision(personId?: string) {
  if (!personId || typeof window === "undefined") return 0;
  try { return Number(window.sessionStorage.getItem(revisionStorageKey(personId)) ?? 0) || 0; } catch { return 0; }
}

export function ContactAvatar({ personId, name, size = 28, revision }: { personId?: string; name: string; size?: number; revision?: string | number }) {
  const [failed, setFailed] = useState(false);
  const initials = name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";
  const subscribeToRevision = useCallback((notify: () => void) => {
    if (!personId || typeof window === "undefined") return () => undefined;
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ personId?: string; revision?: number }>).detail;
      if (detail?.personId !== personId) return;
      const nextRevision = detail.revision ?? Date.now();
      try { window.sessionStorage.setItem(revisionStorageKey(personId), String(nextRevision)); } catch { /* Cache refresh remains best-effort. */ }
      setFailed(false);
      notify();
    };
    window.addEventListener("solvani:avatar-updated", refresh);
    return () => window.removeEventListener("solvani:avatar-updated", refresh);
  }, [personId]);
  const readRevision = useCallback(() => storedRevision(personId), [personId]);
  const cacheRevision = useSyncExternalStore(subscribeToRevision, readRevision, () => 0);
  // A saved revision lets a newly mounted surface bypass a prior private image
  // response after the owner changes a photo elsewhere in this browser tab.
  const revisionValue = Math.max(cacheRevision, typeof revision === "number" ? revision : 0);
  const source = useMemo(() => personId ? contactAvatarUrl(personId, `${typeof revision === "string" ? revision : "current"}-${revisionValue}`) : "", [personId, revision, revisionValue]);

  if (!personId || failed) return <span className="contact-avatar-fallback" style={{ width: size, height: size }} aria-hidden="true">{initials}</span>;
  return <span className="contact-avatar-wrap" style={{ width: size, height: size }}><Image src={source} alt="" width={size} height={size} unoptimized sizes={`${size}px`} onError={() => setFailed(true)} /></span>;
}
