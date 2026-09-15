import { describe, expect, it } from "vitest";
import { recentWindowStartIso } from "./recent-window";

describe("recentWindowStartIso", () => {
  it("returns an ISO cutoff without depending on the browser timezone", () => {
    expect(recentWindowStartIso(31, new Date("2026-09-15T12:00:00.000Z"))).toBe("2026-08-15T12:00:00.000Z");
  });

  it("rejects invalid windows", () => {
    expect(() => recentWindowStartIso(0, new Date())).toThrow("days must be a positive number");
  });
});
