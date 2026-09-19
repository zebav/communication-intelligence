import { reconcileBrowserSession, type ReconciliationStore } from "./browser-reconciliation";
import { checkBrowserRequest } from "./browser-network";
import { PageSetGuard, navigationReachedTarget, type BrowserPage } from "./browser-guards";

type Provider = {
  create(input: { requestId: string; approvedHost: string; targetUrl: string }): Promise<{ sessionId: string }>;
  stop(id: string): Promise<unknown>;
  inspect(id: string): Promise<{ sessionId: string; terminated: boolean }>;
};
/** Driver must intercept every request, redirect, popup and subresource before network access.
 * It must block service workers, downloads, WebSockets and unapproved writes; pin DNS at egress.
 * No production driver is installed yet. Do not equate a preflight DNS lookup with egress protection.
 */
export interface ReadOnlyBrowserDriver {
  read(input: { sessionId: string; url: string; signal: AbortSignal; authorize: (url: string, method: string) => Promise<unknown>; pages: PageSetGuard }): Promise<{ text: string; openPages: BrowserPage[]; topFrameUrl: string }>;
}

export async function runReadOnlyBrowserTask(input: {
  requestId: string; targetUrl: string; approvedUrls: readonly string[];
}, deps: {
  enabled: boolean; provider: Provider; store: ReconciliationStore;
  driver: ReadOnlyBrowserDriver | null;
  check?: typeof checkBrowserRequest;
}) {
  if (!deps.enabled || !deps.driver) throw new Error("Säker webbexekvering är inte aktiverad.");
  const approvedUrls = [...input.approvedUrls];
  const { requestId, targetUrl } = input;
  const controller = new AbortController();
  const check = deps.check ?? checkBrowserRequest;
  const pages = new PageSetGuard(approvedUrls, check);
  const authorize = async (url: string, method: string) => {
    if (controller.signal.aborted) throw new Error("Task ended");
    const result = await check({ url, method, approvedUrls });
    if (controller.signal.aborted) throw new Error("Task ended");
    return result;
  };
  await authorize(targetUrl, "GET");
  const { sessionId } = await deps.provider.create({ requestId, targetUrl, approvedHost: new URL(targetUrl).hostname });
  let text: string | null = null;
  let failed = false;
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Task deadline")); }, 240_000);
    });
    let value: Awaited<ReturnType<ReadOnlyBrowserDriver["read"]>>;
    try {
      value = await Promise.race([deps.driver.read({ sessionId, url: targetUrl, signal: controller.signal, authorize, pages }), deadline]);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
    if (typeof value?.text !== "string" || value.text.length > 100_000) throw new Error("Invalid result");
    navigationReachedTarget(targetUrl, value.topFrameUrl);
    await pages.verify(value.openPages);
    text = value.text;
  } catch { failed = true; }
  // Always try cleanup, but never infer termination from successful stop submission.
  try { await deps.provider.stop(sessionId); } catch { /* inspect may still prove termination */ }
  let closed = false;
  try { closed = (await reconcileBrowserSession(requestId, deps.store, id => deps.provider.inspect(id))).closed; } catch { /* retain lock */ }
  return {
    status: failed ? "failed" as const : "read" as const,
    text,
    cleanup: closed ? "confirmed" as const : "needs_review" as const,
    // Page text is untrusted evidence, never permission to perform an action.
    externalSubmissionPerformed: false as const,
  };
}
