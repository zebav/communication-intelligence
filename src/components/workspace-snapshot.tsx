"use client";

import { useState, useTransition, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { Workspace } from "./workspace";

type Props = ComponentProps<typeof Workspace>;

// Memory belongs to this authenticated page instance, never global/localStorage.
// A failed refresh must not overwrite known data with null-to-empty fallbacks.
export function WorkspaceSnapshot({ data, failedSections }: { data: Props; failedSections: string[] }) {
  // `data` is already a safe partial snapshot: every failed server query falls
  // back to an empty collection. Never turn that usable snapshot into a blank
  // page just because one optional section missed its deadline.
  const [lastGood, setLastGood] = useState<Props>(data);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  if (!failedSections.length && lastGood !== data) setLastGood(data);
  const visible = failedSections.length ? lastGood ?? data : data;
  return <>
    {failedSections.length > 0 && <div className="empty-card" role="alert">
      <strong>Arbetsytan kunde inte uppdateras</strong>
      <p>De delar som hann laddas visas fortfarande. Uppgifterna kan vara inaktuella, men ingenting har tagits bort.</p>
      <p>Berörda delar: {failedSections.join(", ")}.</p>
      <button className="btn" disabled={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? "Hämtar igen…" : "Försök igen"}</button>
    </div>}
    {visible && <Workspace {...visible} backgroundPaused={failedSections.length > 0} />}
  </>;
}
