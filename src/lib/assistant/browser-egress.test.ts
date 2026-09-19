// @vitest-environment node
import { expect, it } from "vitest";
import { BrowserEgressGate } from "./browser-egress";
import { checkBrowserRequest } from "./browser-network";

const url = "https://example.com/approved";
const check: typeof checkBrowserRequest = input => checkBrowserRequest(input, async () => [{ address: "8.8.8.8" }]);
const gate = () => new BrowserEgressGate([url], check);

it("requires interception before navigation and a verified document request", async () => {
  const g = gate();
  await expect(g.authorize({ url, method: "GET", kind: "document" })).rejects.toThrow();
  g.interceptionInstalled();
  expect(() => g.verify()).toThrow();
  await g.authorize({ url, method: "GET", kind: "document" });
  expect(() => g.verify()).not.toThrow();
  g.close();
  expect(() => g.verify()).toThrow();
});

it.each([
  { url, method: "POST", kind: "document" as const },
  { url: "https://example.com/other", method: "GET", kind: "iframe" as const },
  { url: "https://other.example/page", method: "GET", kind: "subresource" as const },
  { url, method: "GET", kind: "websocket" as const },
  { url, method: "GET", kind: "download" as const },
  { url, method: "GET", kind: "service-worker" as const },
])("blocks $kind $method $url and latches the failure", async request => {
  const g = gate(); g.interceptionInstalled();
  await expect(g.authorize(request)).rejects.toThrow();
  await expect(g.authorize({ url, method: "GET", kind: "document" })).rejects.toThrow();
  expect(() => g.verify()).toThrow();
});

it("blocks requests completed after the task closes", async () => {
  let release!: () => void;
  const delayed: typeof checkBrowserRequest = async input => {
    await new Promise<void>(resolve => { release = resolve; });
    return check(input);
  };
  const g = new BrowserEgressGate([url], delayed); g.interceptionInstalled();
  const pending = g.authorize({ url, method: "GET", kind: "document" });
  g.close(); release();
  await expect(pending).rejects.toThrow();
});
