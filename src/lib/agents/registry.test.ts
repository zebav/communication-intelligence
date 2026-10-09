import { describe, expect, it } from "vitest";
import { agentById, mayAgentUseService, ownerAgentForAutomation } from "./registry";

describe("agent registry boundaries", () => {
  it("keeps every role behind owner approval for external effects", () => {
    expect(agentById("communication_intelligence")?.requiresOwnerApprovalForExternalEffects).toBe(true);
    expect(agentById("browser_execution")?.requiresOwnerApprovalForExternalEffects).toBe(true);
  });

  it("allows only the explicitly listed service ceiling", () => {
    expect(mayAgentUseService("calendar_scheduling", "google_maps", "suggest")).toBe(true);
    expect(mayAgentUseService("calendar_scheduling", "google_maps", "prepare")).toBe(false);
    expect(mayAgentUseService("communication_intelligence", "slack", "prepare")).toBe(false);
    expect(mayAgentUseService("communication_intelligence", "browserbase", "read")).toBe(false);
  });

  it("assigns existing durable work to one accountable specialist", () => {
    expect(ownerAgentForAutomation("slack_intelligence")).toBe("communication_intelligence");
    expect(ownerAgentForAutomation("relationship_backfill")).toBe("relationship_intelligence");
    expect(ownerAgentForAutomation("vault_ingestion")).toBe("document_knowledge");
    expect(ownerAgentForAutomation("autonomous_learning")).toBe("system_orchestrator");
  });
});
