import { describe, expect, it } from "vitest";
import {
  buildBrowserDomainPolicy,
  exactHttpsHost,
  isExactHostAllowed,
  mayExecuteBrowserAction,
} from "./domain-policy";

describe("browser domain policy", () => {
  it("accepts public https hosts and preserves exact hostnames", () => {
    expect(exactHttpsHost("https://www.example.com/path?q=1")).toBe("www.example.com");
    expect(buildBrowserDomainPolicy(["https://booking.example.com/a"]))?.toEqual({
      exactHosts: ["booking.example.com"],
      browserbaseDomains: ["booking.example.com"],
    });
  });

  it("blocks local and private targets", () => {
    expect(exactHttpsHost("http://example.com")).toBeNull();
    expect(exactHttpsHost("https://localhost/test")).toBeNull();
    expect(exactHttpsHost("https://127.0.0.1/test")).toBeNull();
    expect(exactHttpsHost("https://192.168.1.2/test")).toBeNull();
    expect(exactHttpsHost("https://172.20.1.2/test")).toBeNull();
    expect(exactHttpsHost("https://10.0.0.2/test")).toBeNull();
  });

  it("uses exact-host checks in our own enforcement layer", () => {
    expect(isExactHostAllowed("https://www.example.com/a", ["www.example.com"])).toBe(true);
    expect(isExactHostAllowed("https://evil.www.example.com/a", ["www.example.com"])).toBe(false);
    expect(isExactHostAllowed("https://example.com/a", ["www.example.com"])).toBe(false);
  });

  it("requires approval for high risk and refuses critical execution", () => {
    const base = { targetUrl: "https://example.com", exactHosts: ["example.com"] };
    expect(mayExecuteBrowserAction({ ...base, risk: "medium", approved: false })).toBe(true);
    expect(mayExecuteBrowserAction({ ...base, risk: "high", approved: false })).toBe(false);
    expect(mayExecuteBrowserAction({ ...base, risk: "high", approved: true })).toBe(true);
    expect(mayExecuteBrowserAction({ ...base, risk: "critical", approved: true })).toBe(false);
  });
});
