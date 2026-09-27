import Constants from "expo-constants";

export type Task = { id: string; revision: number; kind: string; status: string; plan: { evidence: { personName: string; title: string; source: string; account: string }; reason: string; draft: string } };
export type Snapshot = { tasks: Task[]; candidates: Array<{ messageId: string; kind: string; plan: Task["plan"] }>; notes: Array<{ messageId: string; personName: string; title: string; source: string; account: string; priority: number; summary: string }> };
const base = String(Constants.expoConfig?.extra?.apiUrl || "").replace(/\/$/, "");
export async function assistant(token: string): Promise<Snapshot> {
  const response = await fetch(`${base}/api/assistant`, { headers: { Authorization: `Bearer ${token}`, "X-Client": "ios" } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Notiscentret kunde inte laddas.");
  return body;
}
export async function dismiss(token: string, messageId: string, kind: string) {
  const response = await fetch(`${base}/api/assistant`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Client": "ios" }, body: JSON.stringify({ action: "dismiss_candidate", messageId, kind, scope: "message" }) });
  const body = await response.json(); if (!response.ok) throw new Error(body.error || "Meddelandet kunde inte sorteras bort.");
}
