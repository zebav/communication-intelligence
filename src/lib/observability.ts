type OperationLog = {
  route: string;
  operation: string;
  durationMs: number;
  outcome: "completed" | "failed" | "timed_out" | "queued";
  requestId?: string | null;
  traceId?: string | null;
  counts?: Record<string, number>;
  error?: unknown;
};

/**
 * A small, privacy-safe baseline for Vercel runtime logs. Never put message
 * content, addresses, tokens, or account identifiers in these events.
 */
export function logOperation(input: OperationLog) {
  const event = {
    level: input.outcome === "failed" || input.outcome === "timed_out" ? "error" : "info",
    event: "solvani_operation",
    route: input.route,
    operation: input.operation,
    outcome: input.outcome,
    duration_ms: input.durationMs,
    request_id: input.requestId ?? undefined,
    trace_id: input.traceId ?? undefined,
    counts: input.counts,
    error: input.error instanceof Error ? input.error.message.slice(0, 180) : typeof input.error === "string" ? input.error.slice(0, 180) : undefined,
  };
  if (event.level === "error") console.error(JSON.stringify(event));
  else console.log(JSON.stringify(event));
}
