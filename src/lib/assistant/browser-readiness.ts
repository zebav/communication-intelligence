export type BrowserReadiness = {
  enabled: boolean;
  mode: "managed_agent" | "preparation";
  blockers: string[];
  capabilities: {
    executeStandardWebTasks: boolean;
    persistentSiteLogin: boolean;
    secureVariables: boolean;
    criticalActions: boolean;
  };
};

/**
 * Browserbase managed Agents are the production execution path for standard,
 * explicitly approved website tasks. Payments, legal signatures, destructive
 * account changes and security changes remain outside this capability.
 */
export function browserReadiness(): BrowserReadiness {
  const configured = Boolean(process.env.BROWSERBASE_API_KEY?.trim());
  return {
    enabled: configured,
    mode: configured ? "managed_agent" : "preparation",
    blockers: configured ? [] : ["Browserbase API-nyckeln saknas i servermiljön."],
    capabilities: {
      executeStandardWebTasks: configured,
      persistentSiteLogin: configured,
      secureVariables: configured,
      criticalActions: false,
    },
  };
}
