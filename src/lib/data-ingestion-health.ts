import type { SupabaseClient } from "@supabase/supabase-js";

export type IngestionConnection = { id: string; provider: string; account: string; status: string; health: string; lastSyncAt: string | null; needsAttention: boolean };
export type IngestionHealth = { pendingMedia: number; failedMedia: number; deadLetterMedia: number; retrievalPending: number; retrievalFailed: number; analysisPending: number; vaultRetained: number; oldestPendingAt: string | null; affectedConnectionIds: string[]; connections: IngestionConnection[] };

export async function readDataIngestionHealth(database: SupabaseClient, ownerId?: string): Promise<IngestionHealth> {
  let query = database.from("vault_ingestion_jobs").select("connection_id,state,created_at,retrieval_status,analysis_status,vault_status").order("created_at", { ascending: true }).limit(200);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { data, error } = await query;
  if (error) throw new Error("Media queue could not be read.");
  const rows = data ?? [];
  const pending = rows.filter((item) => item.state === "pending" || item.state === "processing");
  const failed = rows.filter((item) => item.state === "failed");
  const deadLetter = rows.filter((item) => item.state === "dead_letter");
  let connections: IngestionConnection[] = [];
  if (ownerId) {
    const { data, error: connectionError } = await database.from("connections")
      .select("id,provider,account_identifier,account_name,status,health_status,last_sync_at")
      .eq("owner_id", ownerId).in("status", ["connected", "reconnect_required", "error"]).order("updated_at", { ascending: false }).limit(30);
    if (connectionError) throw new Error("Connection health could not be read.");
    connections = (data ?? []).map((connection) => {
      const lastSyncAt = typeof connection.last_sync_at === "string" ? connection.last_sync_at : null;
      const health = typeof connection.health_status === "string" ? connection.health_status : "unknown";
      return {
        id: connection.id,
        provider: connection.provider,
        account: connection.account_identifier ?? connection.account_name ?? "Anslutet konto",
        status: connection.status,
        health,
        lastSyncAt,
        // The automation handles a stale timestamp and bounded retries. Only
        // a disconnected credential needs intervention from the owner.
        needsAttention: connection.status !== "connected" || health === "reconnect_required",
      };
    });
  }
  return { pendingMedia: pending.length, failedMedia: failed.length, deadLetterMedia: deadLetter.length, retrievalPending: rows.filter((item) => item.retrieval_status === "queued" || item.retrieval_status === "fetching").length, retrievalFailed: rows.filter((item) => item.retrieval_status === "failed" || item.retrieval_status === "expired").length, analysisPending: rows.filter((item) => item.analysis_status === "queued" || item.analysis_status === "processing").length, vaultRetained: rows.filter((item) => item.vault_status === "retained").length, oldestPendingAt: pending[0]?.created_at ?? null, affectedConnectionIds: [...new Set([...failed, ...deadLetter].map((item) => item.connection_id).filter((id): id is string => typeof id === "string"))], connections };
}
