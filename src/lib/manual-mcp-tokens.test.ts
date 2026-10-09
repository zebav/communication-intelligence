import { describe, expect, it } from "vitest";
import { hashToken, issueOpaqueToken } from "./mcp-oauth";
import { isManualMcpToken, manualMcpTokenFingerprint } from "./manual-mcp-tokens";

describe("manual MCP bearer tokens", () => {
  it("uses an unguessable prefixed token with a non-secret fingerprint", () => {
    const token = issueOpaqueToken("slv_mcp_", 32);
    expect(isManualMcpToken(token)).toBe(true);
    expect(manualMcpTokenFingerprint(token)).toHaveLength(8);
    expect(token.endsWith(manualMcpTokenFingerprint(token))).toBe(true);
    expect(hashToken(token)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not accept OAuth tokens as manual bearer tokens", () => {
    expect(isManualMcpToken("slv_at_not-a-manual-token")).toBe(false);
    expect(isManualMcpToken("slv_mcp_short")).toBe(false);
  });
});
