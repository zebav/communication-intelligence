import type { SupabaseClient } from "@supabase/supabase-js";

export type IngestionConnection = { id: string; provider: string; account: string; status: string; health: string; lastSyncAt: string | null; lastInboundAt: string | null; needsAttention: boolean };
export type IngestionHealth = { pendingMedia: number; failedMedia: number; deadLetterMedia: number; retrievalPending: number; retrievalFailed: number; analysisPending: number; vaultRetained: number; oldestPendingAt: string | null; affectedConnectionIds: string[]; connections: IngestionConnection[] };

/**
 * Return lifecycle status from database counts rather than an arbitrary page
 * of old jobs. The former implementation could keep surfacing a historical
 * attachment after it had recovered and hide newer work behind the 200-row
 * limit, which made the UI operationally misleading.
 */
export async function readDataIngestionHealth(database: SupabaseClient, ownerId?: string): Promise<IngestionHealth> {
  const jobsCount = () => {
    const query = database.from("vault_ingestion_jobs").select("id", { count: "exact", head: true });
    return ownerId ? query.eq("owner_id", ownerId) : query;
  };
  const oldestBase = database.from("vault_ingestion_jobs").select("created_at");
  const oldest = (ownerId ? oldestBase.eq("owner_id", ownerId) : oldestBase)
    .in("state", ["pending", "processing"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const affectedBase = database.from("vault_ingestion_jobs").select("connection_id");
  const affected = (ownerId ? affectedBase.eq("owner_id", ownerId) : affectedBase)
    .in("state", ["failed", "dead_letter"])
    .not("connection_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(100);
  const [pendingResult, failedResult, deadLetterResult, retrievalPendingResult, retrievalFailedResult, analysisPendingResult, retainedResult, oldestResult, affectedResult] = await Promise.all([
    jobsCount().in("state", ["pending", "processing"]),
    jobsCount().eq("state", "failed"),
    jobsCount().eq("state", "dead_letter"),
    jobsCount().in("retrieval_status", ["queued", "fetching"]),
    jobsCount().in("retrieval_status", ["failed", "expired"]),
    jobsCount().in("analysis_status", ["queued", "processing"]),
    jobsCount().eq("vault_status", "retained"),
    oldest,
    affected,
  ]);
  if ([pendingResult, failedResult, deadLetterResult, retrievalPendingResult, retrievalFailedResult, analysisPendingResult, retainedResult, oldestResult, affectedResult].some((result) => result.error)) {
    throw new Error("Media queue could not be read.");
  }
  let connections: IngestionConnection[] = [];
  if (ownerId) {
    // A successful sync does not prove that source material is arriving. Read
    // only timestamps and already-linked connection ids: message content has
    // no place in a health UI.
    const [connectionResult, inboundResult] = await Promise.all([
      database.from("connections").select("id,provider,account_identifier,account_name,status,health_status,last_sync_at")
        .eq("owner_id", ownerId).in("status", ["connected", "reconnect_required", "error"]).order("updated_at", { ascending: false }).limit(30),
      database.from("messages").select("sent_at,conversations!inner(connection_id)")
        .eq("owner_id", ownerId).eq("direction", "in").order("sent_at", { ascending: false }).limit(500),
    ]);
    const { data, error: connectionError } = connectionResult;
    if (connectionError) throw new Error("Connection health could not be read.");
    // A transient join error must not hide the remaining health data.
    const latestInboundByConnection = new Map<string, string>();
    if (!inboundResult.error) for (const row of inboundResult.data ?? []) {
      const conversation = row.conversations as { connection_id?: unknown } | null;
      const connectionId = conversation?.connection_id;
      if (typeof connectionId === "string" && typeof row.sent_at === "string" && !latestInboundByConnection.has(connectionId)) latestInboundByConnection.set(connectionId, row.sent_at);
    }
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
        lastInboundAt: latestInboundByConnection.get(connection.id) ?? null,
        // The automation handles a stale timestamp and bounded retries. Only
        // a disconnected credential needs intervention from the owner.
        needsAttention: connection.status !== "connected" || health === "reconnect_required",
      };
    });
  }
  return {
    pendingMedia: pendingResult.count ?? 0,
    failedMedia: failedResult.count ?? 0,
    deadLetterMedia: deadLetterResult.count ?? 0,
    retrievalPending: retrievalPendingResult.count ?? 0,
    retrievalFailed: retrievalFailedResult.count ?? 0,
    analysisPending: analysisPendingResult.count ?? 0,
    vaultRetained: retainedResult.count ?? 0,
    oldestPendingAt: typeof oldestResult.data?.created_at === "string" ? oldestResult.data.created_at : null,
    affectedConnectionIds: [...new Set(((affectedResult.data ?? []) as Array<{ connection_id: unknown }>).map((item) => item.connection_id).filter((id): id is string => typeof id === "string"))],
    connections,
  };
}
