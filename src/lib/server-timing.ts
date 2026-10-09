/**
 * Privacy-safe request timing. Keys are static operation names only; callers
 * must never use account, message or person values as timing names.
 */
export type ServerTiming = Record<string, number>;

export async function measureServerTiming<T>(timings: ServerTiming, name: string, work: () => PromiseLike<T>) {
  const startedAt = performance.now();
  try {
    return await work();
  } finally {
    timings[name] = Math.max(0, Math.round(performance.now() - startedAt));
  }
}

export function serverTimingHeader(timings: ServerTiming) {
  return Object.entries(timings)
    .filter(([name, duration]) => /^[a-z_]+$/.test(name) && Number.isFinite(duration))
    .map(([name, duration]) => `${name};dur=${duration}`)
    .join(", ");
}
