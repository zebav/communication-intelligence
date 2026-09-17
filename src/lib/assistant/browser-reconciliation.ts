type Reservation = { requestId: string; sessionId: string | null; state: string };
export interface ReconciliationStore {
  read(requestId: string): Promise<Reservation | null>;
  /** CAS on requestId + exact sessionId + non-closed state; do not refund reserved costs. */
  closeVerified(requestId: string, sessionId: string): Promise<boolean>;
}

/** No retries or guessed session IDs. Unknown starts require manual provider investigation. */
export async function reconcileBrowserSession(
  requestId: string,
  store: ReconciliationStore,
  inspect: (id: string) => Promise<{ sessionId: string; terminated: boolean }>,
) {
  const reservation = await store.read(requestId);
  if (!reservation || reservation.requestId !== requestId) throw new Error("Reservationen saknas.");
  if (reservation.state === "closed") return { closed: true, alreadyClosed: true };
  if (!reservation.sessionId) return { closed: false, manualReview: true };
  const status = await inspect(reservation.sessionId);
  if (status.sessionId !== reservation.sessionId) throw new Error("Fel sessionskvitto.");
  if (!status.terminated) return { closed: false, manualReview: false };
  const closed = await store.closeVerified(requestId, reservation.sessionId);
  if (!closed) throw new Error("Reservationen ändrades under avstämningen.");
  return { closed: true, alreadyClosed: false };
}
