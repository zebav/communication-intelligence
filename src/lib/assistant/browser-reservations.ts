import type { SupabaseClient } from "@supabase/supabase-js";
import type { BrowserReservationStore } from "./browserbase-provider";
import type { ReconciliationStore } from "./browser-reconciliation";

/** Requires a server-only service-role client. Never expose through a client-callable action. */
export function browserReservationStore(db: SupabaseClient, worstCaseAiMicroUsd: number): BrowserReservationStore & ReconciliationStore {
  if (!Number.isSafeInteger(worstCaseAiMicroUsd) || worstCaseAiMicroUsd < 0 || worstCaseAiMicroUsd > 10_000_000) throw new Error("AI-reservationen kunde inte verifieras.");
  return {
    async read(requestId) {
      const { data, error } = await db.from("assistant_browser_reservations")
        .select("request_id,session_id,state").eq("request_id", requestId).maybeSingle();
      if (error) throw new Error("Reservationen kunde inte läsas.");
      return data ? { requestId: data.request_id, sessionId: data.session_id, state: data.state } : null;
    },
    async closeVerified(requestId, sessionId) {
      const { data, error } = await db.from("assistant_browser_reservations")
        .update({ state: "closed" }).eq("request_id", requestId).eq("session_id", sessionId)
        .in("state", ["running", "uncertain"]).select("request_id");
      if (error) throw new Error("Avstämningen kunde inte sparas.");
      return data?.length === 1;
    },
    async reserve(requestId) {
      const { error } = await db.rpc("assistant_reserve_browser", { p_request_id: requestId, p_ai_micro_usd: worstCaseAiMicroUsd });
      if (error) throw new Error("Webbuppgiften kunde inte reservera budget. Ingen session startades.");
    },
    async attach(requestId, sessionId) {
      const { data, error } = await db.from("assistant_browser_reservations")
        .update({ session_id: sessionId, state: "running" }).eq("request_id", requestId)
        .eq("state", "reserved").select("request_id");
      if (error || data?.length !== 1) throw new Error("Sessionskvittot kunde inte sparas.");
    },
    async uncertain(requestId) {
      const { data, error } = await db.from("assistant_browser_reservations")
        .update({ state: "uncertain" }).eq("request_id", requestId)
        .in("state", ["reserved", "running", "uncertain"]).select("request_id");
      // A failed update still leaves the original reservation locked, never refunded.
      if (error || data?.length !== 1) throw new Error("Reservationen måste granskas manuellt.");
    },
  };
}
