import "server-only";
import { createHash } from "node:crypto";
import type { Plan, Task } from "@/lib/assistant/model";
import { listKnowledgeEntries, upsertKnowledgeEntry } from "@/lib/personal-knowledge";

export type BrowserFieldKind = "text" | "email" | "phone" | "date" | "username" | "password" | "account_number" | "one_time_code" | "other";
export type BrowserFieldRequirement = {
  key: string;
  label: string;
  kind: BrowserFieldKind;
  description: string;
  sensitivity: "personal" | "sensitive" | "restricted";
  persist: boolean;
  category: "credentials" | "web_forms";
  vaultKey: string;
};

function normalizedFieldKey(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "field";
}

export function browserActionHost(plan: Plan) {
  const raw = plan.evidence.analysis.actionSuggestion?.targetUrl?.trim() ?? "";
  if (!raw) throw new Error("Webbuppgiften saknar en verifierad HTTPS-adress.");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("Webbuppgiften har en otillåten adress.");
  return { host: url.hostname.toLowerCase(), url: url.href };
}

function vaultKey(host: string, key: string) {
  const normalized = normalizedFieldKey(key);
  const digest = createHash("sha256").update(`${host}\u0000${normalized}`).digest("hex").slice(0, 10);
  return `${host.slice(0, 48)}:${normalized.slice(0, 48)}:${digest}`;
}

function requirement(input: {
  host: string;
  key: string;
  label: string;
  kind: BrowserFieldKind;
  description?: string;
  sensitivity?: "personal" | "sensitive" | "restricted";
}): BrowserFieldRequirement {
  const persist = input.kind !== "one_time_code";
  const category = input.kind === "username" || input.kind === "password" ? "credentials" as const : "web_forms" as const;
  const sensitivity = input.kind === "password" || input.kind === "one_time_code"
    ? "restricted"
    : input.sensitivity ?? (input.kind === "account_number" ? "restricted" : "sensitive");
  return {
    key: normalizedFieldKey(input.key),
    label: input.label.trim().slice(0, 120) || input.key,
    kind: input.kind,
    description: (input.description ?? "").trim().slice(0, 240),
    sensitivity,
    persist,
    category,
    vaultKey: vaultKey(input.host, input.key),
  };
}

export function browserFieldRequirements(plan: Plan): BrowserFieldRequirement[] {
  const action = plan.evidence.analysis.actionSuggestion;
  if (!action?.detected) return [];
  const { host } = browserActionHost(plan);
  const raw = Array.isArray(action.requiredFields) ? action.requiredFields : [];
  const result = raw.map((field) => requirement({ host, ...field }));
  const kinds = new Set(result.map((field) => field.kind));
  if (action.requiresLogin) {
    if (!kinds.has("username") && !kinds.has("email")) result.unshift(requirement({ host, key: "username", label: "Användarnamn eller e-post", kind: "username", description: "Inloggningsuppgift för webbplatsen.", sensitivity: "restricted" }));
    if (!kinds.has("password")) result.push(requirement({ host, key: "password", label: "Lösenord", kind: "password", description: "Lösenord för webbplatsen.", sensitivity: "restricted" }));
  }
  const seen = new Set<string>();
  return result.filter((field) => {
    const unique = `${field.kind}:${field.key}`;
    if (seen.has(unique)) return false;
    seen.add(unique);
    return true;
  }).slice(0, 12);
}

function runtimeRequirements(plan: Plan, result: Record<string, unknown>): BrowserFieldRequirement[] {
  const raw = Array.isArray(result.browserMissingInformation) ? result.browserMissingInformation : [];
  let host: string;
  try { host = browserActionHost(plan).host; } catch { return []; }
  return raw.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const field = value as Record<string, unknown>;
    const kind = typeof field.kind === "string" ? field.kind : "";
    const sensitivity = typeof field.sensitivity === "string" ? field.sensitivity : "";
    if (
      typeof field.key !== "string" ||
      typeof field.label !== "string" ||
      !["text","email","phone","date","username","password","account_number","one_time_code","other"].includes(kind) ||
      !["personal","sensitive","restricted"].includes(sensitivity)
    ) return [];
    return [requirement({
      host,
      key: field.key,
      label: field.label,
      kind: kind as BrowserFieldKind,
      description: typeof field.description === "string" ? field.description : "",
      sensitivity: sensitivity as "personal" | "sensitive" | "restricted",
    })];
  }).slice(0, 12);
}

export function browserTaskFieldRequirements(task: Pick<Task, "plan" | "result">) {
  const combined = [...browserFieldRequirements(task.plan), ...runtimeRequirements(task.plan, task.result)];
  const seen = new Set<string>();
  return combined.filter((field) => {
    const unique = `${field.kind}:${field.key}`;
    if (seen.has(unique)) return false;
    seen.add(unique);
    return true;
  }).slice(0, 12);
}

export async function browserFieldStates(ownerId: string, task: Pick<Task, "plan" | "result">) {
  const { host } = browserActionHost(task.plan);
  const requirements = browserTaskFieldRequirements(task);
  const entries = await listKnowledgeEntries(ownerId);
  return requirements.map((field) => {
    const existing = entries.find((entry) =>
      entry.category === field.category &&
      entry.key === field.vaultKey &&
      entry.metadata?.siteHost === host &&
      entry.metadata?.fieldKey === field.key
    );
    return {
      ...field,
      hasValue: field.persist ? Boolean(existing?.value) : false,
      source: existing ? "vault" as const : "missing" as const,
    };
  });
}

export async function saveBrowserField(ownerId: string, task: Pick<Task, "plan" | "result">, input: { key: string; value: string }) {
  const { host } = browserActionHost(task.plan);
  const requirements = browserTaskFieldRequirements(task);
  const field = requirements.find((item) => item.key === normalizedFieldKey(input.key));
  if (!field) throw new Error("Uppgiften ingår inte i den godkända webbåtgärden.");
  if (!field.persist) throw new Error("Engångskoder sparas inte. Ange koden direkt när webbuppgiften körs.");
  const value = input.value.trim();
  if (!value || value.length > 20_000) throw new Error("Kontrollera uppgiften och försök igen.");
  return upsertKnowledgeEntry(ownerId, {
    category: field.category,
    key: field.vaultKey,
    value,
    sensitivity: field.sensitivity,
    allowedUses: [`browser:${host}`],
    verified: true,
    metadata: {
      siteHost: host,
      fieldKey: field.key,
      label: field.label,
      kind: field.kind,
      secret: field.kind === "password" || field.kind === "account_number",
      browserManaged: true,
    },
  });
}

function variableName(field: BrowserFieldRequirement, index: number) {
  const base = field.key.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 48) || `field_${index + 1}`;
  return `vault_${index + 1}_${base}`;
}

export async function browserVariables(ownerId: string, task: Pick<Task, "plan" | "result">, ephemeral: Record<string, string> = {}) {
  const { host } = browserActionHost(task.plan);
  const requirements = browserTaskFieldRequirements(task);
  const entries = await listKnowledgeEntries(ownerId);
  const variables: Record<string, { value: string; description: string }> = {};
  const placeholders: Record<string, string> = {};
  const missing: BrowserFieldRequirement[] = [];

  requirements.forEach((field, index) => {
    const name = variableName(field, index);
    let value = "";
    if (field.persist) {
      const entry = entries.find((item) =>
        item.category === field.category &&
        item.key === field.vaultKey &&
        item.metadata?.siteHost === host &&
        item.metadata?.fieldKey === field.key &&
        (!item.allowedUses.length || item.allowedUses.includes(`browser:${host}`))
      );
      value = entry?.value ?? "";
    } else {
      value = ephemeral[field.key]?.trim() ?? "";
    }
    if (!value) {
      missing.push(field);
      return;
    }
    variables[name] = {
      value,
      description: field.description || `${field.label} för ${host}. Använd endast för den godkända webbuppgiften.`,
    };
    placeholders[field.key] = `%${name}%`;
  });

  return { variables, placeholders, missing };
}
