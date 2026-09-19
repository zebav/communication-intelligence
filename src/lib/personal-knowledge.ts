import "server-only";
import { z } from "zod";
import { encryptCredential, decryptCredential } from "@/lib/connectors/credential-crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const knowledgeSensitivitySchema = z.enum(["standard","personal","sensitive","restricted"]);
export const knowledgeEntryInputSchema = z.object({
  category: z.string().trim().min(1).max(80),
  key: z.string().trim().min(1).max(120),
  value: z.string().max(20000),
  sensitivity: knowledgeSensitivitySchema.default("personal"),
  allowedUses: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  verified: z.boolean().default(true),
  expiresAt: z.string().datetime().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type KnowledgeEntryInput = z.infer<typeof knowledgeEntryInputSchema>;
export type KnowledgeEntry = KnowledgeEntryInput & {
  id: string;
  source: string;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function key() {
  const value = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!value) throw new Error("Knowledge vault encryption is not configured.");
  return value;
}

export async function listKnowledgeEntries(ownerId: string): Promise<KnowledgeEntry[]> {
  const db = createAdminClient();
  const { data, error } = await db.from("personal_knowledge_entries")
    .select("id,category,key,encrypted_value,sensitivity,source,allowed_uses,verified_at,expires_at,metadata,created_at,updated_at")
    .eq("owner_id", ownerId).order("category").order("key");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    category: row.category,
    key: row.key,
    value: decryptCredential<{ value: string }>(row.encrypted_value, key()).value,
    sensitivity: row.sensitivity,
    source: row.source,
    allowedUses: Array.isArray(row.allowed_uses) ? row.allowed_uses : [],
    verified: Boolean(row.verified_at),
    verifiedAt: row.verified_at,
    expiresAt: row.expires_at,
    metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function upsertKnowledgeEntry(ownerId: string, input: KnowledgeEntryInput) {
  const parsed = knowledgeEntryInputSchema.parse(input);
  const now = new Date().toISOString();
  const db = createAdminClient();
  const { data, error } = await db.from("personal_knowledge_entries").upsert({
    owner_id: ownerId,
    category: parsed.category,
    key: parsed.key,
    encrypted_value: encryptCredential({ value: parsed.value }, key()),
    sensitivity: parsed.sensitivity,
    source: "owner",
    allowed_uses: parsed.allowedUses,
    verified_at: parsed.verified ? now : null,
    expires_at: parsed.expiresAt ?? null,
    metadata: parsed.metadata,
    updated_at: now,
  }, { onConflict: "owner_id,category,key" }).select("id").single();
  if (error) throw error;
  return data;
}

export async function deleteKnowledgeEntry(ownerId: string, id: string) {
  const db = createAdminClient();
  const { error } = await db.from("personal_knowledge_entries").delete().eq("id", id).eq("owner_id", ownerId);
  if (error) throw error;
}

export async function selectKnowledgeForUse(ownerId: string, input: { keys: Array<{ category: string; key: string }>; use: string; allowRestricted?: boolean }) {
  const requested = new Set(input.keys.map((item) => `${item.category}\u0000${item.key}`));
  const entries = await listKnowledgeEntries(ownerId);
  return entries.filter((entry) => requested.has(`${entry.category}\u0000${entry.key}`)
    && (entry.sensitivity !== "restricted" || input.allowRestricted === true)
    && (!entry.allowedUses.length || entry.allowedUses.includes(input.use))
    && (!entry.expiresAt || new Date(entry.expiresAt).getTime() > Date.now()));
}

