import { expect, it } from "vitest";
import { browserSessionPolicy } from "./browser-policy";
const input = { approvedHost: "example.com", targetUrl: "https://example.com/form", reservedSeconds: 0, activeSessions: 0 };
it("uses short sessions without proxies, recordings or keep-alive", () => expect(browserSessionPolicy(input)).toMatchObject({ timeout: 300, keepAlive: false, proxies: false, browserSettings: { recordSession: false, logSession: false, allowedDomains: ["example.com"] } }));
it.each(["http://example.com", "https://evil.example.com", "https://example.com:8443", "https://user:password@example.com"])("blocks unapproved navigation %s", targetUrl => expect(() => browserSessionPolicy({ ...input, targetUrl })).toThrow());
it.each([NaN, -1, 90 * 3600, Infinity])("fails closed for invalid or exhausted usage %s", reservedSeconds => expect(() => browserSessionPolicy({ ...input, reservedSeconds })).toThrow());
it("blocks concurrent work", () => expect(() => browserSessionPolicy({ ...input, activeSessions: 1 })).toThrow());
it.each(["127.0.0.1", "foo.local", "localhost", "foo.internal"])("rejects local hosts %s", approvedHost => expect(() => browserSessionPolicy({ ...input, approvedHost, targetUrl: `https://${approvedHost}` })).toThrow());
