"use client";

import { useRouter } from "next/navigation";

export function BackToWorkspaceButton() {
  const router = useRouter();
  return <button className="btn" type="button" onClick={() => {
    if (window.history.length > 1) router.back();
    else router.push("/");
  }}>← Back to workspace</button>;
}
