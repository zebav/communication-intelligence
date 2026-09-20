import { afterEach, expect, it, vi } from "vitest";
import { browserReadiness } from "./browser-readiness";

afterEach(() => vi.unstubAllEnvs());

it("keeps Browserbase unavailable when its server credential is missing", () => {
  vi.stubEnv("BROWSERBASE_API_KEY", "");
  expect(browserReadiness()).toMatchObject({ enabled: false, mode: "preparation" });
  expect(browserReadiness().blockers).toHaveLength(1);
});

it("enables managed standard web actions when Browserbase is configured", () => {
  vi.stubEnv("BROWSERBASE_API_KEY", "test-browserbase-key");
  expect(browserReadiness()).toMatchObject({
    enabled: true,
    mode: "managed_agent",
    blockers: [],
    capabilities: {
      executeStandardWebTasks: true,
      persistentSiteLogin: true,
      secureVariables: true,
      criticalActions: false,
    },
  });
});
