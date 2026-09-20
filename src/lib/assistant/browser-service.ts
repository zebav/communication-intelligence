import type { SupabaseClient } from "@supabase/supabase-js";
import { browserReservationStore } from "./browser-reservations";
import { browserbaseProvider } from "./browserbase-provider";
import { reconcileBrowserSession } from "./browser-reconciliation";
import { runReadOnlyBrowserTask, type ReadOnlyBrowserDriver } from "./browser-run";
import { executeApprovedBrowserRead } from "./browser-approval";
import { browserApprovalStore } from "./browser-approval-store";
import { z } from "zod";
import { checkBrowserRequest } from "./browser-network";

/** Internal server composition, not a public endpoint. Caller must authenticate owner/MFA
 * and resolve the exact approved task from storage, never accept approval from page content.
 * No AI calls in this read-only stage. A live driver is deliberately not provided by default.
 */
export function browserService(config: {
  db: SupabaseClient; apiKey: string; projectId: string; enabled: boolean;
  driver: ReadOnlyBrowserDriver | null;
  authenticate: () => Promise<{ userId: string; aal: string }>;
}) {
  if (typeof window !== "undefined") throw new Error("Webbtjänsten får bara köras på servern.");
  const store = browserReservationStore(config.db, 0);
  const provider = browserbaseProvider({ apiKey: config.apiKey, projectId: config.projectId, enabled: config.enabled, store });
  const approvals = browserApprovalStore(config.db);
  return {
    async prepareRead(input: { taskId: string; revision: number; targetUrl: string; confirmed: boolean }) {
      // Do not issue executable approvals while the live driver is unavailable.
      if (!config.enabled || !config.driver) throw new Error("Säker webbexekvering är inte aktiverad.");
      const reviewed = z.object({ taskId: z.string().uuid(), revision: z.number().int().positive(), targetUrl: z.string().url().max(4096), confirmed: z.literal(true) }).parse(input);
      const actor = await config.authenticate();
      if (actor.aal !== "aal2" || !z.string().uuid().safeParse(actor.userId).success) throw new Error("Bekräfta din inloggning först.");
      await checkBrowserRequest({ url: reviewed.targetUrl, method: "GET", approvedUrls: [reviewed.targetUrl] });
      return approvals.prepare({ ownerId: actor.userId, taskId: reviewed.taskId, revision: reviewed.revision, targetUrl: reviewed.targetUrl });
    },
    async runApprovedRead(input: Parameters<typeof executeApprovedBrowserRead>[0]) {
      if (!config.enabled || !config.driver) throw new Error("Säker webbexekvering är inte aktiverad.");
      return executeApprovedBrowserRead(input, {
        authenticate: config.authenticate, ...approvals,
        run: value => runReadOnlyBrowserTask(value, { enabled: config.enabled, driver: config.driver, store, provider }),
      });
    },
    reconcile: (requestId: string) => reconcileBrowserSession(requestId, store, id => provider.inspect(id)),
    async stop(requestId: string) {
      const row = await store.read(requestId);
      if (!row?.sessionId) throw new Error("Sessionen kräver manuell granskning.");
      await provider.stop(row.sessionId);
      return reconcileBrowserSession(requestId, store, id => provider.inspect(id));
    },
  };
}
