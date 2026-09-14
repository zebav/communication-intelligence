"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const PERSON_SELECTORS = [
  ".thread-head strong",
  ".case-title strong",
  ".card-person strong",
  ".conversation-row strong",
  ".case-person-name",
];

export function PersonNavigationBridge() {
  const router = useRouter();

  useEffect(() => {
    const handler = async (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const personElement = PERSON_SELECTORS.map((selector) => target.closest(selector)).find(Boolean) as HTMLElement | undefined;
      if (!personElement) return;
      const name = personElement.textContent?.replace(/\s+·\s+New\s*$/, "").trim();
      if (!name || name.length > 200) return;
      event.preventDefault();
      event.stopPropagation();
      personElement.style.cursor = "wait";
      try {
        const response = await fetch(`/api/contacts/resolve?name=${encodeURIComponent(name)}`, { cache: "no-store" });
        const result = await response.json() as { personId?: string };
        if (response.ok && result.personId) router.push(`/contacts/${result.personId}`);
      } finally {
        personElement.style.cursor = "pointer";
      }
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [router]);

  return null;
}
