import { serviceById, servicePermissionAtMost, type ServiceId, type ServicePermission } from "@/lib/services/catalog";
import type { AutomationOperation } from "@/lib/automation-jobs";

/**
 * A policy registry, not a second execution framework. It gives every future
 * specialist role an explicit, reviewable ceiling over the services it may
 * request. The existing approval and execution services remain authoritative
 * for every side effect.
 */
export type AgentId =
  | "system_orchestrator"
  | "communication_intelligence"
  | "relationship_intelligence"
  | "research_travel"
  | "calendar_scheduling"
  | "document_knowledge"
  | "legal_intelligence"
  | "finance_intelligence"
  | "health_intelligence"
  | "browser_execution"
  | "system_reliability"
  | "ux_product_quality";

export type AgentDefinition = {
  id: AgentId;
  name: string;
  purpose: string;
  services: Readonly<Partial<Record<ServiceId, ServicePermission>>>;
  requiresOwnerApprovalForExternalEffects: true;
  handlesSensitiveData: boolean;
};

const prepare = "prepare" as const;
const suggest = "suggest" as const;
const read = "read" as const;

export const agentRegistry: readonly AgentDefinition[] = [
  { id: "system_orchestrator", name: "System Orchestrator", purpose: "Routes durable maintenance work and keeps specialist roles within their policy boundaries.", services: {}, requiresOwnerApprovalForExternalEffects: true, handlesSensitiveData: true },
  { id: "communication_intelligence", name: "Communication Intelligence", purpose: "Classifies inbound communication and prepares channel-appropriate drafts.", services: { gmail: prepare, outlook: prepare, instagram: prepare, whatsapp: prepare, slack: suggest }, requiresOwnerApprovalForExternalEffects: true, handlesSensitiveData: true },
  { id: "relationship_intelligence", name: "Relationship Intelligence", purpose: "Maintains evidence-backed relationship context and prioritisation support.", services: {}, requiresOwnerApprovalForExternalEffects: true, handlesSensitiveData: true },
  { id: "research_travel", name: "Research & Travel Intelligence", purpose: "Prepares place, route and travel research without confirming a booking.", services: { google_maps: suggest, browserbase: prepare }, requiresOwnerApprovalForExternalEffects: true, handlesSensitiveData: true },
  { id: "calendar_scheduling", name: "Calendar & Scheduling", purpose: "Prepares availability, travel-aware meeting plans and approved calendar actions.", services: { google_calendar: prepare, outlook_calendar: prepare, google_maps: suggest }, requiresOwnerApprovalForExternalEffects: true, handlesSensitiveData: true },
  { id: "document_knowledge", name: "Document & Knowledge Intelligence", purpose: "Retrieves only owner-authorized documents and associates them with decisions.", services: { google_drive: read, onedrive: read, google_photos: read }, requiresOwnerApprovalForExternalEffects: true, handlesSensitiveData: true },
  { id: "legal_intelligence", name: "Legal Intelligence", purpose: "Prepares legal review context and routes decisions for human review; it never signs or commits.", services: { google_drive: read, onedrive: read, browserbase: prepare }, requiresOwnerApprovalForExternalEffects: true, handlesSensitiveData: true },
  { id: "finance_intelligence", name: "Finance Intelligence", purpose: "Prepares invoice and accounting context; payments remain outside agent authority.", services: { gmail: read, outlook: read, google_drive: read, onedrive: read }, requiresOwnerApprovalForExternalEffects: true, handlesSensitiveData: true },
  { id: "health_intelligence", name: "Health Intelligence", purpose: "Prepares private health-related communication and documents under narrow contextual access.", services: { gmail: read, outlook: read, google_calendar: suggest, outlook_calendar: suggest, google_drive: read, onedrive: read }, requiresOwnerApprovalForExternalEffects: true, handlesSensitiveData: true },
  { id: "browser_execution", name: "Browser & Execution", purpose: "Prepares exact approved web tasks through the existing guarded Browserbase flow.", services: { browserbase: prepare }, requiresOwnerApprovalForExternalEffects: true, handlesSensitiveData: true },
  { id: "system_reliability", name: "System Reliability", purpose: "Observes source freshness, durable jobs and recoverable failures without reading message content.", services: {}, requiresOwnerApprovalForExternalEffects: true, handlesSensitiveData: false },
  { id: "ux_product_quality", name: "UX & Product Quality", purpose: "Uses aggregate operational evidence to propose product improvements; it cannot alter the live workspace.", services: {}, requiresOwnerApprovalForExternalEffects: true, handlesSensitiveData: false },
] as const;

export function agentById(id: string) {
  return agentRegistry.find((agent) => agent.id === id);
}

export function mayAgentUseService(agentId: AgentId, serviceId: ServiceId, requestedPermission: ServicePermission) {
  const agent = agentById(agentId);
  const service = serviceById(serviceId);
  const ceiling = agent?.services[serviceId];
  return Boolean(
    agent
      && service
      && service.available
      && ceiling
      && requestedPermission !== "off"
      && servicePermissionAtMost(requestedPermission, ceiling)
      && servicePermissionAtMost(requestedPermission, service.maxPermission),
  );
}

/** Maps existing durable jobs to their specialist owner without changing how a job executes. */
export function ownerAgentForAutomation(operation: AutomationOperation): AgentId {
  if (operation === "autonomous_learning") return "system_orchestrator";
  if (operation === "follow_up_detection") return "communication_intelligence";
  if (operation === "relationship_backfill") return "relationship_intelligence";
  if (operation === "calendar_sync") return "calendar_scheduling";
  if (operation === "vault_ingestion") return "document_knowledge";
  if (operation === "gmail_intelligence" || operation === "outlook_intelligence" || operation === "instagram_intelligence" || operation === "whatsapp_intelligence" || operation === "slack_intelligence") return "communication_intelligence";
  return "system_orchestrator";
}
