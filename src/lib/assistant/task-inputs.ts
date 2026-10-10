import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptCredential } from "@/lib/connectors/credential-crypto";
import { upsertKnowledgeEntry } from "@/lib/personal-knowledge";
import { createAdminClient } from "@/lib/supabase/admin";
import { taskInputKinds, type Task, type TaskInputRequirement } from "./model";

const requestSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,63}$/),
  value: z.string().trim().min(1).max(3_000),
});

function encryptionKey() {
  const value = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!value) throw new Error("Knowledge vault encryption is not configured.");
  return value;
}

function entryKey(taskId: string, key: string) {
  return `${taskId}:${key}`;
}

function inputUse(taskId: string) {
  return `assistant-task:${taskId}`;
}

function requirement(task: Task, key: string) {
  return task.plan.inputRequirements?.find((item) => item.key === key) ?? null;
}

function validateValue(item: TaskInputRequirement, value: string) {
  if (item.kind === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Välj ett giltigt datum.");
  }
  if (item.kind === "email" && !z.string().email().safeParse(value).success) {
    throw new Error("Ange en giltig e-postadress.");
  }
  if (!taskInputKinds.includes(item.kind)) throw new Error("Denna typ av uppgift stöds inte.");
}

/** Save no plaintext in `assistant_tasks`; this is deliberately a vault write. */
export async function saveTaskInput(ownerId: string, task: Task, input: unknown) {
  const parsed = requestSchema.parse(input);
  const item = requirement(task, parsed.key);
  if (!item) throw new Error("Den efterfrågade uppgiften hör inte till detta uppdrag.");
  validateValue(item, parsed.value);
  const reusable = item.persistence !== "task_only";
  const category = reusable ? "personal_context" : "assistant_task";
  const key = reusable ? `assistant_${item.key}` : entryKey(task.id, item.key);
  await upsertKnowledgeEntry(ownerId, {
    category,
    key,
    value: parsed.value,
    sensitivity: item.persistence === "restricted_reusable" ? "restricted" : item.sensitivity,
    allowedUses: reusable ? ["assistant"] : [inputUse(task.id)],
    verified: true,
    expiresAt: reusable ? null : new Date(Date.now() + 30 * 86_400_000).toISOString(),
    metadata: { taskId: task.id, inputKey: item.key, persistence: item.persistence, taskInput: true },
  });
}

/** Read only the exact scoped keys required by this task, never the whole vault. */
export async function readTaskInputs(_db: SupabaseClient, ownerId: string, task: Task): Promise<Record<string, string>> {
  const requests = task.plan.inputRequirements ?? [];
  if (!requests.length) return {};
  const taskOnlyKeys = requests.filter((item) => item.persistence === "task_only").map((item) => entryKey(task.id, item.key));
  if (!taskOnlyKeys.length) return {};
  const { data, error } = await createAdminClient().from("personal_knowledge_entries")
    .select("key,encrypted_value,expires_at,allowed_uses")
    .eq("owner_id", ownerId).eq("category", "assistant_task").in("key", taskOnlyKeys);
  if (error) throw new Error("Den sparade uppgiften kunde inte läsas.");
  const allowed = inputUse(task.id);
  return Object.fromEntries((data ?? []).flatMap((row) => {
    if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return [];
    if (Array.isArray(row.allowed_uses) && !row.allowed_uses.includes(allowed)) return [];
    const key = String(row.key).slice(`${task.id}:`.length);
    try { return [[key, decryptCredential<{ value: string }>(row.encrypted_value, encryptionKey()).value] as const]; } catch { return []; }
  }));
}
