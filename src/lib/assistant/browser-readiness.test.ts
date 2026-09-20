import { afterEach, expect, it, vi } from "vitest";
import { browserReadiness } from "./browser-readiness";
afterEach(() => vi.unstubAllEnvs());
it("cannot enable the missing live driver using environment flags", () => {
  vi.stubEnv("ASSISTANT_EXECUTION_ENABLED", "true");
  vi.stubEnv("BROWSER_EXECUTION_ENABLED", "true");
  expect(browserReadiness()).toMatchObject({ enabled: false, mode: "preparation" });
  expect(browserReadiness().blockers).toHaveLength(3);
});
