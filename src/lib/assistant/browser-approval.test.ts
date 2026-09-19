// @vitest-environment node
import { expect, it, vi } from "vitest";
import { executeApprovedBrowserRead, type BrowserApproval } from "./browser-approval";

function fixture() {
  const row: BrowserApproval = {
    id: "10000000-0000-4000-8000-000000000001", ownerId: "10000000-0000-4000-8000-000000000002",
    taskId: "10000000-0000-4000-8000-000000000003", revision: 2, mode: "read_only", status: "approved",
    targetUrl: "https://example.com/page", approvedUrls: ["https://example.com/page"],
    approvedAt: "2026-09-17T10:00:00Z", expiresAt: "2026-09-17T11:00:00Z",
  };
  let consumed = false;
  const deps = {
    authenticate: vi.fn(async () => ({ userId: row.ownerId, aal: "aal2" })),
    load: vi.fn(async () => row),
    claim: vi.fn(async () => { if (consumed) return false; consumed = true; return true; }),
    run: vi.fn(async () => ({ status: "read", text: "Synthetic", cleanup: "confirmed", externalSubmissionPerformed: false })),
    finish: vi.fn(async () => undefined), now: () => Date.parse("2026-09-17T10:30:00Z"),
  };
  return { row, deps, input: { approvalId: row.id, taskId: row.taskId, revision: row.revision } };
}
it("uses only the stored approved target after authentication and claim", async () => {
  const f = fixture(); await executeApprovedBrowserRead(f.input, f.deps);
  expect(f.deps.run).toHaveBeenCalledWith({ requestId: f.row.id, targetUrl: f.row.targetUrl, approvedUrls: f.row.approvedUrls });
  expect(f.deps.load).toHaveBeenCalledWith(f.row.id, f.row.ownerId);
});
it("requires MFA before reading approval", async () => {
  const f = fixture(); f.deps.authenticate.mockResolvedValue({ userId: f.row.ownerId, aal: "aal1" });
  await expect(executeApprovedBrowserRead(f.input, f.deps)).rejects.toThrow();
  expect(f.deps.load).not.toHaveBeenCalled(); expect(f.deps.run).not.toHaveBeenCalled();
});
it.each(["ownerId", "taskId", "id"] as const)("rejects mismatched %s", async key => {
  const f = fixture(); const owner = f.row.ownerId;
  f.deps.authenticate.mockResolvedValue({ userId: owner, aal: "aal2" });
  f.row[key] = "10000000-0000-4000-8000-000000000099";
  await expect(executeApprovedBrowserRead(f.input, f.deps)).rejects.toThrow(); expect(f.deps.claim).not.toHaveBeenCalled();
});
it.each(["expired", "future", "revision", "url"])("blocks %s approval", async kind => {
  const f = fixture();
  if (kind === "expired") f.row.expiresAt = "2026-09-17T10:30:00Z";
  if (kind === "future") f.row.approvedAt = "2026-09-17T10:31:00Z";
  if (kind === "revision") f.row.revision++;
  if (kind === "url") f.row.targetUrl = "https://other.example/";
  await expect(executeApprovedBrowserRead(f.input, f.deps)).rejects.toThrow(); expect(f.deps.run).not.toHaveBeenCalled();
});
it("allows one of two competing calls, with an atomic claim adapter", async () => {
  const f = fixture(); const results = await Promise.allSettled([executeApprovedBrowserRead(f.input, f.deps), executeApprovedBrowserRead(f.input, f.deps)]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); expect(f.deps.run).toHaveBeenCalledTimes(1);
});
it("does not replay after an uncertain run failure", async () => {
  const f = fixture(); f.deps.run.mockRejectedValue(new Error("uncertain"));
  expect(await executeApprovedBrowserRead(f.input, f.deps)).toMatchObject({ status: "failed", cleanup: "needs_review" });
  expect(f.deps.finish).toHaveBeenCalledWith(expect.anything(), "uncertain", expect.objectContaining({ text: null }));
  await expect(executeApprovedBrowserRead(f.input, f.deps)).rejects.toThrow(); expect(f.deps.run).toHaveBeenCalledTimes(1);
});
it("saves successful reading as waiting for review, not done", async () => {
  const f = fixture(); await executeApprovedBrowserRead(f.input, f.deps);
  expect(f.deps.finish).toHaveBeenCalledWith(expect.anything(), "waiting", expect.objectContaining({ status: "read" }));
});
it("does not rerun if result persistence fails", async () => {
  const f = fixture(); f.deps.finish.mockRejectedValue(new Error("offline"));
  await expect(executeApprovedBrowserRead(f.input, f.deps)).rejects.toThrow("låst");
  await expect(executeApprovedBrowserRead(f.input, f.deps)).rejects.toThrow();
  expect(f.deps.run).toHaveBeenCalledTimes(1);
});
