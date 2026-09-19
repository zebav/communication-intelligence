// @vitest-environment node
import { expect, it, vi } from "vitest";
import { runReadOnlyBrowserTask } from "./browser-run";
import { browserbaseProvider } from "./browserbase-provider";
import { reserveWebBudget } from "./browser-budget";
import { checkBrowserRequest } from "./browser-network";

const input = { requestId: "job-1", targetUrl: "https://example.com/page", approvedUrls: ["https://example.com/page"] };
function fixture() {
  let row: { requestId: string; sessionId: string | null; state: string } | null = null;
  let budget = { browserSeconds: 0, aiMicroUsd: 0, activeSessions: 0 };
  let terminated = false;
  const store = {
    reserve: vi.fn(async (requestId: string) => {
      if (row) throw new Error("duplicate");
      budget = reserveWebBudget({ ...budget, now: 1000, periodStart: 0, periodEnd: 1_000_000, requestedAiMicroUsd: 0 });
      row = { requestId, sessionId: null, state: "reserved" };
    }),
    attach: vi.fn(async (requestId: string, sessionId: string) => { row = { requestId, sessionId, state: "running" }; }),
    uncertain: vi.fn(async () => { if (row) row.state = "uncertain"; }),
    read: vi.fn(async () => row),
    closeVerified: vi.fn(async (requestId: string, sessionId: string) => {
      if (!row || row.requestId !== requestId || row.sessionId !== sessionId) return false;
      row.state = "closed"; budget.activeSessions = 0; return true;
    }),
  };
  const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "GET") return new Response(JSON.stringify({ id: "session-1", status: terminated ? "COMPLETED" : "RUNNING", endedAt: terminated ? "2026-01-01T00:00:00Z" : null }));
    if (String(init?.body).includes("REQUEST_RELEASE")) terminated = true;
    return new Response(JSON.stringify({ id: "session-1" }));
  });
  const provider = browserbaseProvider({ apiKey: "synthetic-key", projectId: "synthetic-project", enabled: true, store, fetcher });
  const check = (value: Parameters<typeof checkBrowserRequest>[0]) => checkBrowserRequest(value, async () => [{ address: "8.8.8.8" }]);
  const driver = { read: vi.fn(async ({ authorize, url, pages, network }: { authorize: (url: string, method: string) => Promise<unknown>; url: string; pages: { opened: (page: { id: string; url: string }) => Promise<void> }; network: { interceptionInstalled: () => void; authorize: (request: { url: string; method: string; kind: "document" | "subresource" | "iframe" | "websocket" | "download" | "service-worker" }) => Promise<unknown> } }) => { network.interceptionInstalled(); await authorize(url, "GET"); await pages.opened({ id: "main", url }); return { text: "Synthetic public page", openPages: [{ id: "main", url }], topFrameUrl: url }; }) };
  return { deps: { enabled: true, store, provider, driver, check }, fetcher, budget: () => budget, row: () => row };
}
it("runs reservation → create → authorized read → stop → inspect → close without refunds", async () => {
  const f = fixture();
  expect(await runReadOnlyBrowserTask(input, f.deps)).toEqual({ status: "read", text: "Synthetic public page", cleanup: "confirmed", externalSubmissionPerformed: false });
  expect(f.row()?.state).toBe("closed"); expect(f.budget().browserSeconds).toBe(300);
  expect(f.fetcher).toHaveBeenCalledTimes(3);
});
it("blocks duplicate replay without another provider call", async () => {
  const f = fixture(); await runReadOnlyBrowserTask(input, f.deps);
  await expect(runReadOnlyBrowserTask(input, f.deps)).rejects.toThrow(); expect(f.fetcher).toHaveBeenCalledTimes(3);
});
it("cleans up after a prohibited redirect", async () => {
  const f = fixture(); f.deps.driver.read.mockImplementation(async ({ authorize, url }) => { await authorize("https://other.example/page", "GET"); return { text: "never", openPages: [], topFrameUrl: url }; });
  expect(await runReadOnlyBrowserTask(input, f.deps)).toMatchObject({ status: "failed", cleanup: "confirmed", text: null });
});
it("blocks form submission and still cleans up", async () => {
  const f = fixture(); f.deps.driver.read.mockImplementation(async ({ authorize, url }) => { await authorize(url, "POST"); return { text: "never", openPages: [], topFrameUrl: url }; });
  expect(await runReadOnlyBrowserTask(input, f.deps)).toMatchObject({ status: "failed", cleanup: "confirmed" });
});
it("retains the lock after unconfirmed shutdown", async () => {
  const f = fixture(); vi.spyOn(f.deps.provider, "stop").mockRejectedValue(new Error("offline"));
  expect(await runReadOnlyBrowserTask(input, f.deps)).toMatchObject({ cleanup: "needs_review" });
  expect(f.row()?.state).toBe("running"); expect(f.budget().activeSessions).toBe(1);
});
it("fails closed without a driver", async () => {
  const f = fixture(); await expect(runReadOnlyBrowserTask(input, { ...f.deps, driver: null })).rejects.toThrow(); expect(f.fetcher).not.toHaveBeenCalled();
});
it("rejects a driver that never installs request interception", async () => {
  const f = fixture();
  f.deps.driver.read.mockImplementation(async ({ url, pages }) => {
    await pages.opened({ id: "main", url });
    return { text: "untrusted", openPages: [{ id: "main", url }], topFrameUrl: url };
  });
  expect(await runReadOnlyBrowserTask(input, f.deps)).toMatchObject({ status: "failed", text: null, cleanup: "confirmed" });
});
it("rejects a driver after a blocked subresource even if it returns page text", async () => {
  const f = fixture();
  f.deps.driver.read.mockImplementation(async ({ url, pages, network }) => {
    network.interceptionInstalled();
    await network.authorize({ url, method: "GET", kind: "document" });
    await expect(network.authorize({ url: "https://other.example/tracker", method: "GET", kind: "subresource" })).rejects.toThrow();
    await pages.opened({ id: "main", url });
    return { text: "untrusted", openPages: [{ id: "main", url }], topFrameUrl: url };
  });
  expect(await runReadOnlyBrowserTask(input, f.deps)).toMatchObject({ status: "failed", text: null, cleanup: "confirmed" });
});
it("rejects unapproved initial URLs before reserving", async () => {
  const f = fixture(); await expect(runReadOnlyBrowserTask({ ...input, approvedUrls: [] }, f.deps)).rejects.toThrow(); expect(f.deps.store.reserve).not.toHaveBeenCalled();
});
it("does not expose a driver error or oversized page", async () => {
  const f = fixture(); f.deps.driver.read.mockResolvedValue({ text: "x".repeat(100001), openPages: [], topFrameUrl: input.targetUrl }); expect(await runReadOnlyBrowserTask(input, f.deps)).toMatchObject({ status: "failed", text: null, cleanup: "confirmed" });
});
it("stops and reconciles even if the driver ignores cancellation", async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(); f.deps.driver.read.mockImplementation(() => new Promise(() => {}));
    const result = runReadOnlyBrowserTask(input, f.deps);
    await vi.advanceTimersByTimeAsync(240_001);
    expect(await result).toMatchObject({ status: "failed", cleanup: "confirmed" });
  } finally { vi.useRealTimers(); }
});
it("revokes request authorization after the driver returns", async () => {
  const f = fixture();
  let authorize!: (url: string, method: string) => Promise<unknown>;
  f.deps.driver.read.mockImplementation(async (value) => { value.network.interceptionInstalled(); authorize = value.authorize; await authorize(value.url, "GET"); await value.pages.opened({ id: "main", url: value.url }); return { text: "done", openPages: [{ id: "main", url: value.url }], topFrameUrl: value.url }; });
  await runReadOnlyBrowserTask(input, f.deps);
  await expect(authorize(input.targetUrl, "GET")).rejects.toThrow("Task ended");
});
it("snapshots approval identity and target before asynchronous checks", async () => {
  const f = fixture();
  const mutable = { ...input, approvedUrls: [...input.approvedUrls] };
  const check = f.deps.check;
  f.deps.check = async (value) => {
    mutable.requestId = "changed"; mutable.targetUrl = "https://other.example/";
    mutable.approvedUrls.push(mutable.targetUrl);
    return check(value);
  };
  expect(await runReadOnlyBrowserTask(mutable, f.deps)).toMatchObject({ status: "read", cleanup: "confirmed" });
  expect(f.row()?.requestId).toBe(input.requestId);
  expect(f.deps.driver.read.mock.calls[0][0].url).toBe(input.targetUrl);
});
it("rejects an in-flight authorization that finishes after task completion", async () => {
  const f = fixture();
  let release!: () => void;
  let pending!: Promise<unknown>;
  let count = 0;
  const check = f.deps.check;
  f.deps.check = async (value) => {
    if (++count === 2) await new Promise<void>(resolve => { release = resolve; });
    return check(value);
  };
  f.deps.driver.read.mockImplementation(async ({ authorize, url, pages, network }) => {
    network.interceptionInstalled();
    pending = authorize(url, "GET");
    await pages.opened({ id: "main", url });
    return { text: "done", openPages: [{ id: "main", url }], topFrameUrl: url };
  });
  await runReadOnlyBrowserTask(input, f.deps);
  const rejected = expect(pending).rejects.toThrow("Ett nätverksanrop föll utanför");
  release();
  await rejected;
});
