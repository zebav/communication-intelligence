import { browserSessionPolicy } from "./browser-policy";

/** Server integration seam. No route uses this until the durable ledger and network guard exist. */
export interface BrowserReservationStore {
  /** Must atomically check global budget, request uniqueness and a single-session lock. */
  reserve(requestId: string): Promise<void>;
  /** Persist receipt server-side; never store connectUrl or signingKey in audit logs. */
  attach(requestId: string, sessionId: string): Promise<void>;
  /** Retain the entire reservation and lock pending explicit reconciliation. */
  uncertain(requestId: string): Promise<void>;
}

export function browserbaseProvider(config: { apiKey: string; projectId: string; enabled: boolean; store: BrowserReservationStore; fetcher?: typeof fetch }) {
  const fetcher = config.fetcher ?? fetch;
  async function request(path: string, body?: unknown) {
    try {
      const response = await fetcher(`https://api.browserbase.com/v1/sessions${path}`, {
        method: body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store",
        signal: AbortSignal.timeout(15_000),
        headers: { "Content-Type": "application/json", "X-BB-API-Key": config.apiKey },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("provider failure");
      return await response.json() as Record<string, unknown>;
    } catch {
      // Provider bodies/errors can contain credentials. Do not propagate them.
      throw new Error("Webbläsartjänstens resultat kunde inte verifieras. Ingen automatisk omstart görs.");
    }
  }
  return {
    async inspect(sessionId: string) {
      if (!config.apiKey.trim() || !/^[a-zA-Z0-9-]{1,100}$/.test(sessionId)) throw new Error("Ogiltig session.");
      const receipt = await request(`/${sessionId}`);
      if (receipt.id !== sessionId || !["PENDING", "RUNNING", "ERROR", "TIMED_OUT", "COMPLETED"].includes(String(receipt.status))) throw new Error("Sessionsstatus kunde inte verifieras.");
      const ended = typeof receipt.endedAt === "string" ? Date.parse(receipt.endedAt) : NaN;
      const terminal = ["ERROR", "TIMED_OUT", "COMPLETED"].includes(String(receipt.status));
      return {
        sessionId,
        status: String(receipt.status),
        // Missing or future termination timestamps must not unlock a reservation.
        terminated: terminal && Number.isFinite(ended) && ended <= Date.now(),
      };
    },
    async create(input: { requestId: string; approvedHost: string; targetUrl: string }) {
      if (!config.enabled || !config.apiKey.trim() || !config.projectId.trim()) throw new Error("Molnwebbläsaren är inte aktiverad.");
      if (!/^[a-zA-Z0-9-]{1,100}$/.test(input.requestId)) throw new Error("Ogiltigt uppgifts-id.");
      const policy = browserSessionPolicy({ ...input, reservedSeconds: 0, activeSessions: 0 });
      await config.store.reserve(input.requestId);
      try {
        const receipt = await request("", { ...policy, projectId: config.projectId });
        if (typeof receipt.id !== "string" || !/^[a-zA-Z0-9-]+$/.test(receipt.id)) throw new Error("invalid receipt");
        await config.store.attach(input.requestId, receipt.id);
        // Connection credentials intentionally not returned to consumers yet.
        return { sessionId: receipt.id };
      } catch {
        await config.store.uncertain(input.requestId);
        throw new Error("Sessionens status är osäker. Budgetreservationen behålls.");
      }
    },
    async stop(sessionId: string) {
      // Emergency stop remains available when new execution is disabled.
      if (!config.apiKey.trim() || !/^[a-zA-Z0-9-]{1,100}$/.test(sessionId)) throw new Error("Ogiltig session.");
      await request(`/${sessionId}`, { status: "REQUEST_RELEASE" });
      // A stop request is not confirmation of termination. Never refund here.
      return { stopRequested: true };
    },
  };
}
