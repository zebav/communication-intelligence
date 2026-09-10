import { describe, expect, it } from "vitest";
import { firstSafeExternalActionUrl, safeExternalActionUrl } from "@/lib/safe-action";
describe("safe external action URLs", () => {
  it("allows HTTPS", () => expect(safeExternalActionUrl("https://example.com/form")).toBe("https://example.com/form"));
  it("blocks unsafe addresses", () => { expect(safeExternalActionUrl("http://example.com")).toBeNull(); expect(safeExternalActionUrl("https://localhost/admin")).toBeNull(); expect(safeExternalActionUrl("https://user:secret@example.com")).toBeNull(); });
  it("finds the first safe HTTPS address in message text", () => expect(firstSafeExternalActionUrl("Open https://example.com/form?case=1 to continue.")) .toBe("https://example.com/form?case=1"));
});
