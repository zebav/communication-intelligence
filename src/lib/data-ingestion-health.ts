import type { SupabaseClient } from "@supabase/supabase-js";

export type IngestionConnection = { id: string; provider: string; account: string; health: string; lastSyncAt: string | null; needsAttention: boolean };
export type IngestionHealth = { pendingMedia: number; failedMedia: number; oldestPendingAt: string | null; affectedConnectionIds: string[]; connections: IngestionConnection[] };

export async function readDataIngestionHealth(database: SupabaseClient, ownerId?: string): Promise<IngestionHealth> {
  let query = database.from("vault_ingestion_jobs").select("connection_id,state,created_at").in("state", ["pending", "processing", "failed"]).order("created_at", { ascending: true }).limit(200);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { data, error } = await query;
  if (error) throw new Error("Media queue could not be read.");
  const rows = data ?? [];
  const pending = rows.filter((item) => item.state === "pending" || item.state === "processing");
  const failed = rows.filter((item) => item.state === "failed");
  let connections: IngestionConnection[] = [];
  if (ownerId) {
    const { data, error: connectionError } = await database.from("connections")
      .select("id,provider,account_identifier,account_name,health_status,last_sync_at")
      .eq("owner_id", ownerId).eq("status", "connected").order("updated_at", { ascending: false }).limit(30);
    if (connectionError) throw new Error("Connection health could not be read.");
    const staleAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    connections = (data ?? []).map((connection) => {
      const lastSyncAt = typeof connection.last_sync_at === "string" ? connection.last_sync_at : null;
      const health = typeof connection.health_status === "string" ? connection.health_status : "unknown";
      return {
        id: connection.id,
        provider: connection.provider,
        account: connection.account_identifier ?? connection.account_name ?? "Anslutet konto",
        health,
        lastSyncAt,
        needsAttention: health === "degraded" || !lastSyncAt || Date.parse(lastSyncAt) < staleAt,
      };
    });
  }
  return { pendingMedia: pending.length, failedMedia: failed.length, oldestPendingAt: pending[0]?.created_at ?? null, affectedConnectionIds: [...new Set(failed.map((item) => item.connection_id).filter((id): id is string => typeof id === "string"))], connections };
}
