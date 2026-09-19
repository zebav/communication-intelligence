// @vitest-environment node
import { expect, it } from "vitest";
import { PageSetGuard, browserContextScope, navigationReachedTarget, validateBrowserFile, verifyFinalBrowserAction } from "./browser-guards";
import { checkBrowserRequest } from "./browser-network";

const url = "https://example.com/approved";
const check: typeof checkBrowserRequest = input => checkBrowserRequest(input, async () => [{ address: "8.8.8.8" }]);
const guard = () => new PageSetGuard([url], check);

it("accepts only reported, unchanged pages", async () => {
  const g = guard(); await g.opened({ id: "one", url }); await g.verify([{ id: "one", url }]);
  await expect(g.verify([{ id: "one", url }, { id: "popup", url }])).rejects.toThrow();
});
it("rejects redirects and latches the failure", async () => {
  const g = guard(); await g.opened({ id: "one", url });
  await expect(g.navigated({ id: "one", url: "https://evil.example/page" })).rejects.toThrow();
  await expect(g.verify([{ id: "one", url }])).rejects.toThrow();
});
it("treats blocked or unexpected navigation as uncertain", () => {
  expect(() => navigationReachedTarget(url, url)).not.toThrow();
  expect(() => navigationReachedTarget(url, "https://example.com/other")).toThrow();
});
it("rechecks every page and current approval before a future final action", async () => {
  const g = guard(); await g.opened({ id: "one", url });
  const input = { approvedUrl: url, approvedRevision: 2, currentRevision: 2, approvalExpiresAt: "2026-09-20T00:00:00Z", now: Date.parse("2026-09-19T00:00:00Z"), pages: [{ id: "one", url }], guard: g };
  await expect(verifyFinalBrowserAction(input)).resolves.toBeUndefined();
  await expect(verifyFinalBrowserAction({ ...input, currentRevision: 3 })).rejects.toThrow();
  await expect(verifyFinalBrowserAction({ ...input, pages: [{ id: "one", url: "https://example.com/other" }] })).rejects.toThrow();
});
it("restricts upload and download metadata", () => {
  const policy = { exactDestination: "approved-bucket", allowedMime: ["application/pdf"], maxBytes: 1000 };
  expect(validateBrowserFile({ name: "document.pdf", mime: "application/pdf", bytes: 999, destination: "approved-bucket" }, policy).bytes).toBe(999);
  expect(() => validateBrowserFile({ name: "document.pdf", mime: "application/pdf", bytes: 1001, destination: "approved-bucket" }, policy)).toThrow();
  expect(() => validateBrowserFile({ name: "document.pdf", mime: "text/html", bytes: 999, destination: "approved-bucket" }, policy)).toThrow();
  expect(() => validateBrowserFile({ name: "../document.pdf", mime: "application/pdf", bytes: 999, destination: "approved-bucket" }, policy)).toThrow();
});
it("isolates reusable contexts by user and exact host", () => {
  const a = browserContextScope({ userId: "user-a", approvedHost: "example.com", reuseApproved: true });
  expect(a).toBe(browserContextScope({ userId: "user-a", approvedHost: "example.com", reuseApproved: true }));
  expect(a).not.toBe(browserContextScope({ userId: "user-b", approvedHost: "example.com", reuseApproved: true }));
  expect(a).not.toBe(browserContextScope({ userId: "user-a", approvedHost: "other.com", reuseApproved: true }));
  expect(browserContextScope({ userId: "user-a", approvedHost: "example.com", reuseApproved: false })).toBeNull();
});
