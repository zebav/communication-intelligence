import { expect, it, vi } from "vitest";
import { reconcileBrowserSession } from "./browser-reconciliation";
function fixture() {
  return { store: { read: vi.fn().mockResolvedValue({ requestId: "job", sessionId: "session", state: "running" }), closeVerified: vi.fn().mockResolvedValue(true) }, inspect: vi.fn().mockResolvedValue({ sessionId: "session", terminated: true }) };
}
it("closes only the exact verified reservation", async () => { const f = fixture(); expect(await reconcileBrowserSession("job", f.store, f.inspect)).toMatchObject({ closed: true }); expect(f.store.closeVerified).toHaveBeenCalledWith("job", "session"); });
it("retains unknown starts", async () => { const f = fixture(); f.store.read.mockResolvedValue({ requestId: "job", sessionId: null, state: "uncertain" }); expect(await reconcileBrowserSession("job", f.store, f.inspect)).toMatchObject({ closed: false, manualReview: true }); expect(f.inspect).not.toHaveBeenCalled(); });
it("retains active sessions", async () => { const f = fixture(); f.inspect.mockResolvedValue({ sessionId: "session", terminated: false }); expect(await reconcileBrowserSession("job", f.store, f.inspect)).toMatchObject({ closed: false }); expect(f.store.closeVerified).not.toHaveBeenCalled(); });
it("retains lock when provider is unavailable", async () => { const f = fixture(); f.inspect.mockRejectedValue(new Error("network")); await expect(reconcileBrowserSession("job", f.store, f.inspect)).rejects.toThrow(); expect(f.store.closeVerified).not.toHaveBeenCalled(); });
it("rejects wrong receipt", async () => { const f = fixture(); f.inspect.mockResolvedValue({ sessionId: "other", terminated: true }); await expect(reconcileBrowserSession("job", f.store, f.inspect)).rejects.toThrow(); expect(f.store.closeVerified).not.toHaveBeenCalled(); });
it("does not report success after CAS failure", async () => { const f = fixture(); f.store.closeVerified.mockResolvedValue(false); await expect(reconcileBrowserSession("job", f.store, f.inspect)).rejects.toThrow(); });
