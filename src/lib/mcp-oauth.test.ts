import { describe, expect, it } from "vitest";
import { hasScope, manualMcpTokenFingerprint, normalizeScopes, pkceChallenge } from "@/lib/mcp-oauth";

describe("MCP OAuth helpers", () => {
  it("uses the RFC 7636 S256 PKCE encoding", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
      .toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("defaults to read-only access and never invents write scope", () => {
    expect(normalizeScopes()).toBe("contacts.read");
    expect(normalizeScopes("contacts.write unknown")).toBe("contacts.write");
    expect(hasScope(normalizeScopes(), "contacts.write")).toBe(false);
  });

  it("exposes only the final non-secret token fingerprint", () => {
    expect(manualMcpTokenFingerprint("slv_mcp_1234567890abcdefgh")).toBe("abcdefgh");
  });
});
