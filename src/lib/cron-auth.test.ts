import { describe, expect, it } from "vitest";
import { isAuthorizedCron } from "./cron-auth";

describe("cron authorization", () => {
  it("accepts only an exact bearer secret", () => {
    expect(isAuthorizedCron("Bearer safe-secret", "safe-secret")).toBe(true);
    expect(isAuthorizedCron("Bearer wrong", "safe-secret")).toBe(false);
    expect(isAuthorizedCron(null, "safe-secret")).toBe(false);
    expect(isAuthorizedCron("Bearer safe-secret", undefined)).toBe(false);
  });
});
