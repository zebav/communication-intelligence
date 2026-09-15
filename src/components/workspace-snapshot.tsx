"use client";

import { useState, useTransition, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { Workspace } from "./workspace";

type Props = ComponentProps<typeof Workspace>;

// Memory belongs to this authenticated page instance, never global/localStorage.
// A failed refresh must not overwrite known data with null-to-empty fallbacks.
export function WorkspaceSnapshot({ data, failedSections }: { data: Props; failedSections: string[] }) {
  const [lastGood, setLastGood] = useState<Props | null>(() => failedSections.length ? null : data);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  if (!failedSections.length && lastGood !== data) setLastGood(data);
  const visible = failedSections.length ? lastGood : data;
  return <>
    {failedSections.length > 0 && <div className="empty-card" role="alert">
      <strong>Arbetsytan kunde inte uppdateras</strong>
      <p>{visible ? "Senast hämtade innehåll visas fortfarande. Uppgifterna kan vara inaktuella." : "Innehållet kunde inte hämtas. Detta betyder inte att kontakterna eller meddelandena är borttagna."}</p>
      <p>Berörda delar: {failedSections.join(", ")}.</p>
      <button className="btn" disabled={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? "Hämtar igen…" : "Försök igen"}</button>
    </div>}
    {visible && <Workspace {...visible} backgroundPaused={failedSections.length > 0} />}
  </>;
}
