import type { SupabaseClient } from "@supabase/supabase-js";

export type IngestionHealth = { pendingMedia: number; failedMedia: number; oldestPendingAt: string | null; affectedConnectionIds: string[] };

export async function readDataIngestionHealth(database: SupabaseClient, ownerId?: string): Promise<IngestionHealth> {
  let query = database.from("vault_ingestion_jobs").select("connection_id,state,created_at").in("state", ["pending", "processing", "failed"]).order("created_at", { ascending: true }).limit(200);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { data, error } = await query;
  if (error) throw new Error("Media queue could not be read.");
  const rows = data ?? [];
  const pending = rows.filter((item) => item.state === "pending" || item.state === "processing");
  const failed = rows.filter((item) => item.state === "failed");
  return { pendingMedia: pending.length, failedMedia: failed.length, oldestPendingAt: pending[0]?.created_at ?? null, affectedConnectionIds: [...new Set(failed.map((item) => item.connection_id).filter((id): id is string => typeof id === "string"))] };
}
