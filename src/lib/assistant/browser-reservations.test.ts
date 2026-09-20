import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { browserReservationStore } from "./browser-reservations";
function fixture(data: unknown = [{ request_id: "job" }], error: unknown = null) {
  const query = { update: vi.fn(), eq: vi.fn(), in: vi.fn(), select: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data, error }), then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve) };
  for (const method of [query.update, query.eq, query.in, query.select]) method.mockReturnValue(query);
  const db = { from: vi.fn().mockReturnValue(query), rpc: vi.fn().mockResolvedValue({ error }) };
  return { query, db, store: browserReservationStore(db as unknown as SupabaseClient, 1000) };
}
it("binds closure to request, session and active status without budget update", async () => {
  const f = fixture(); expect(await f.store.closeVerified("job", "session")).toBe(true);
  expect(f.query.eq.mock.calls).toEqual([["request_id", "job"], ["session_id", "session"]]);
  expect(f.query.in).toHaveBeenCalledWith("state", ["running", "uncertain"]);
  expect(f.query.update).toHaveBeenCalledWith({ state: "closed" });
  expect(f.db.from).toHaveBeenCalledTimes(1);
});
it("does not claim closure when no row matched", async () => expect(await fixture([]).store.closeVerified("job", "session")).toBe(false));
it("fails closed on read failure", async () => { await expect(fixture(null, {}).store.read("job")).rejects.toThrow(); });
it("maps the persisted receipt", async () => { expect(await fixture({ request_id: "job", session_id: "session", state: "running" }).store.read("job")).toEqual({ requestId: "job", sessionId: "session", state: "running" }); });
it("reserves through the atomic RPC", async () => { const f = fixture(); await f.store.reserve("job"); expect(f.db.rpc).toHaveBeenCalledWith("assistant_reserve_browser", { p_request_id: "job", p_ai_micro_usd: 1000 }); });
it("does not silently accept lost session receipts", async () => { await expect(fixture([]).store.attach("job", "session")).rejects.toThrow(); });
