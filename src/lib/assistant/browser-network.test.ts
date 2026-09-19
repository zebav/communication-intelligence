// @vitest-environment node
import { expect, it, vi } from "vitest";
import { checkBrowserRequest, publicBrowserAddress } from "./browser-network";
it.each(["127.0.0.1", "10.1.1.1", "169.254.169.254", "100.100.100.100", "172.16.2.3", "192.168.2.1", "198.18.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2001:db8::1", "2002::1", "3fff::1", "not-ip"])("blocks non-public address %s", address => expect(publicBrowserAddress(address)).toBe(false));
it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("accepts global address %s", address => expect(publicBrowserAddress(address)).toBe(true));
const allowed = { url: "https://example.com/page", method: "GET", approvedUrls: ["https://example.com/page"] };
it("accepts exact approved URL", async () => expect(await checkBrowserRequest(allowed, async () => [{ address: "8.8.8.8" }])).toMatchObject({ url: allowed.url }));
it.each(["POST", "PUT", "DELETE", "PATCH"])("blocks writes %s", async method => { const dns = vi.fn(); await expect(checkBrowserRequest({ ...allowed, method }, dns)).rejects.toThrow(); expect(dns).not.toHaveBeenCalled(); });
it.each(["http://example.com/page", "https://example.com/other", "https://example.com/page?send=true", "https://evil.example.com/page", "https://127.0.0.1/page", "https://[::1]/page", "https://user:pass@example.com/page"])("blocks unapproved request %s", async url => { await expect(checkBrowserRequest({ ...allowed, url }, async () => [{ address: "8.8.8.8" }])).rejects.toThrow(); });
it("blocks mixed public/private DNS", async () => { await expect(checkBrowserRequest(allowed, async () => [{ address: "8.8.8.8" }, { address: "10.0.0.1" }])).rejects.toThrow(); });
it("blocks empty DNS", async () => { await expect(checkBrowserRequest(allowed, async () => [])).rejects.toThrow(); });
