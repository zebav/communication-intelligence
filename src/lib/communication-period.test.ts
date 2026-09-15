import { describe, expect, it } from "vitest";
import { isWithinCommunicationPeriod } from "./communication-period";

const now = new Date(2026, 8, 15, 15, 0, 0);

describe("communication overview periods", () => {
  it("separates today and yesterday", () => {
    expect(isWithinCommunicationPeriod(new Date(2026, 8, 15, 8).toISOString(), "today", now)).toBe(true);
    expect(isWithinCommunicationPeriod(new Date(2026, 8, 14, 20).toISOString(), "today", now)).toBe(false);
    expect(isWithinCommunicationPeriod(new Date(2026, 8, 14, 20).toISOString(), "yesterday", now)).toBe(true);
  });

  it("includes the complete rolling calendar window", () => {
    expect(isWithinCommunicationPeriod(new Date(2026, 8, 9, 1).toISOString(), "7days", now)).toBe(true);
    expect(isWithinCommunicationPeriod(new Date(2026, 8, 8, 23).toISOString(), "7days", now)).toBe(false);
    expect(isWithinCommunicationPeriod(new Date(2026, 7, 17, 1).toISOString(), "30days", now)).toBe(true);
  });
});
