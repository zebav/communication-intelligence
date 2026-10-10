/**
 * Run independent provider requests in a small, predictable pool.
 *
 * Connector workers must not create a request for every historical message at
 * once: that exhausts a serverless invocation before the next account gets a
 * chance to sync. Errors intentionally retain the item's original position so
 * callers can record a complete, truthful result.
 */
export async function mapWithConcurrency<T, Result>(
  values: readonly T[],
  limit: number,
  work: (value: T, index: number) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(values.length);
  const workerCount = Math.min(values.length, Math.max(1, Math.floor(limit)));
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await work(values[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
