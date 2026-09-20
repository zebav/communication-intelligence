import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { makePlan, type Evidence, type Task } from "@/lib/assistant/model";
const mocks = vi.hoisted(() => ({ create: vi.fn(), readTask: vi.fn(), readEvidence: vi.fn(), changeTask: vi.fn(), send: vi.fn(), recipient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.create }));
vi.mock("@/lib/assistant/repository", () => ({ readTask: mocks.readTask, readEvidence: mocks.readEvidence, changeTask: mocks.changeTask, verifiedRecipient: mocks.recipient, readCandidates: vi.fn(), generateDraft: vi.fn() }));
vi.mock("@/app/api/connectors/microsoft/reply/route", () => ({ POST: mocks.send }));
vi.mock("@/app/api/connectors/microsoft/forward/route", () => ({ POST: mocks.send }));
vi.mock("@/app/api/connectors/instagram/reply/route", () => ({ POST: mocks.send }));
import { POST } from "./route";
const id = "00000000-0000-4000-8000-000000000001";
const evidence: Evidence = { messageId: id, conversationId: id, personId: id, personName: "Anna", source: "email", connectionId: id, provider: "microsoft-graph", account: "test@example.invalid", title: "Fråga", body: "Hej", sentAt: "2026-09-17T00:00:00Z", direction: "in", lastUserAt: null, lastOtherAt: null, classification: "Business", priority: 7, analysis: { requiresReply: true, draftResponse: "Hej Anna" }, recipient: "anna@example.invalid", version: "one" };
const task: Task = { id, message_id: id, kind: "reply", status: "ready", revision: 2, plan: makePlan(evidence, "reply"), result: {}, created_at: evidence.sentAt, updated_at: evidence.sentAt };
function request(body: unknown, origin = "https://local.invalid") { return new NextRequest("https://local.invalid/api/assistant", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }); }
beforeEach(() => {
  vi.stubEnv("ASSISTANT_EXECUTION_ENABLED", "true");
  const q = { select: vi.fn(() => q), eq: vi.fn(() => q), maybeSingle: vi.fn(async () => ({ data: { id }, error: null })) };
  mocks.create.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id } } }), mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal2" } }) } }, from: vi.fn(() => q) });
  mocks.readTask.mockResolvedValue(structuredClone(task)); mocks.readEvidence.mockResolvedValue(structuredClone(evidence));
  mocks.changeTask.mockImplementation(async (_db, _owner, t, status, plan = t.plan, result = t.result) => ({ ...t, status, plan, result, revision: t.revision + 1 }));
  mocks.send.mockResolvedValue(Response.json({ success: true }));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network call in local test"); }));
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("assistant API boundary", () => {
  it("rejects another origin before looking up credentials", async () => {
    expect((await POST(request({ action: "execute", id, revision: 2, approved: true }, "https://foreign.invalid"))).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("requires an explicit approval field", async () => {
    expect((await POST(request({ action: "execute", id, revision: 2 }))).status).toBe(400);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("requires MFA", async () => {
    mocks.create.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id } } }), mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1" } }) } } });
    expect((await POST(request({ action: "execute", id, revision: 2, approved: true }))).status).toBe(409);
    expect(mocks.readTask).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it("blocks real sends when the rollout switch is off", async () => {
    vi.stubEnv("ASSISTANT_EXECUTION_ENABLED", "false");
    expect((await POST(request({ action: "execute", id, revision: 2, approved: true }))).status).toBe(409);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("binds recipient and account into the existing connector request", async () => {
    const result = await POST(request({ action: "execute", id, revision: 2, approved: true }));
    expect(result.status).toBe(200);
    const body = await mocks.send.mock.calls[0][0].json();
    expect(body.expectedRecipient).toBe("anna@example.invalid"); expect(body.expectedConnectionId).toBe(id);
    expect(mocks.changeTask.mock.calls[0][1]).toBe(id);
    expect(mocks.changeTask.mock.calls[0][3]).toBe("executing");
  });
  it("blocks changed evidence before sending", async () => {
    mocks.readEvidence.mockResolvedValue({ ...evidence, version: "changed" });
    expect((await POST(request({ action: "execute", id, revision: 2, approved: true }))).status).toBe(409);
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.changeTask).not.toHaveBeenCalled();
  });
  it("cannot reuse an old revision", async () => {
    expect((await POST(request({ action: "execute", id, revision: 1, approved: true }))).status).toBe(409);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("blocks replies after the owner has answered elsewhere", async () => {
    const changed = { ...evidence, lastUserAt: "2026-09-17T10:00:00Z" };
    mocks.readTask.mockResolvedValue({ ...task, plan: { ...task.plan, evidence: changed } }); mocks.readEvidence.mockResolvedValue(changed);
    expect((await POST(request({ action: "execute", id, revision: 2, approved: true }))).status).toBe(409);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
