import type { SupabaseClient } from "@supabase/supabase-js";
import type { BrowserApproval, BrowserReadResult } from "./browser-approval";

/** Internal service-role adapter. Never instantiate with a browser client. */
export function browserApprovalStore(db: SupabaseClient) {
  if (typeof window !== "undefined") throw new Error("Godkännanden hanteras endast på servern.");
  return {
    async prepare(input: { ownerId: string; taskId: string; revision: number; targetUrl: string }): Promise<unknown> {
      const { data, error } = await db.rpc("assistant_prepare_browser_approval", {
        p_owner_id: input.ownerId, p_task_id: input.taskId, p_revision: input.revision, p_target_url: input.targetUrl,
      });
      if (error || !data) throw new Error("Uppgiften har ändrats eller godkännandet kunde inte sparas. Granska igen.");
      return data;
    },
    async finish(approval: Readonly<BrowserApproval>, status: "waiting" | "uncertain", result: BrowserReadResult): Promise<void> {
      const { data, error } = await db.from("assistant_tasks")
        .update({ status, result: { ...result, browserApprovalId: approval.id } })
        .eq("id", approval.taskId).eq("owner_id", approval.ownerId).eq("kind", "website")
        .eq("revision", approval.revision + 1).eq("status", "executing").select("id").maybeSingle();
      if (error || !data) throw new Error("Webbresultatet kunde inte sparas.");
    },
    async load(id: string, ownerId: string): Promise<unknown> {
      const { data, error } = await db.from("assistant_browser_approvals").select("payload,consumed_at")
        .eq("id", id).eq("owner_id", ownerId).is("consumed_at", null).maybeSingle();
      if (error || !data || data.consumed_at) throw new Error("Godkännandet kunde inte läsas.");
      return data.payload;
    },
    async claim(approval: Readonly<BrowserApproval>): Promise<boolean> {
      // Database time is authoritative. Do not accept caller-provided time for expiry.
      const { data, error } = await db.rpc("assistant_claim_browser_approval", { p_payload: approval });
      if (error) throw new Error("Godkännandet kunde inte reserveras. Försök inte automatiskt igen.");
      return data === true;
    },
  };
}
