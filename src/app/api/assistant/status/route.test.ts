import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.create }));
vi.mock("@/lib/supabase/mobile", () => ({ createMobileClient: vi.fn() }));

import { GET } from "./route";

const ownerId = "00000000-0000-4000-8000-000000000001";
const messageId = "00000000-0000-4000-8000-000000000002";
const taskId = "00000000-0000-4000-8000-000000000003";

beforeEach(() => {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    order: vi.fn(async () => ({ data: [
      { id: taskId, message_id: messageId, kind: "reply", status: "ready", revision: 3, updated_at: "2026-10-09T10:00:00Z" },
      { id: "00000000-0000-4000-8000-000000000004", message_id: messageId, kind: "website", status: "decision", revision: 1, updated_at: "2026-10-08T10:00:00Z" },
    ], error: null })),
  };
  mocks.create.mockResolvedValue({
    auth: {
      getUser: async () => ({ data: { user: { id: ownerId } }, error: null }),
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal2" }, error: null }) },
    },
    from: vi.fn(() => query),
  });
});

describe("assistant decision status projection", () => {
  it("returns only the newest persisted decision for each requested message", async () => {
    const response = await GET(new NextRequest(`https://local.invalid/api/assistant/status?messageId=${messageId}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ tasks: [{ id: taskId, message_id: messageId, kind: "reply", status: "ready", revision: 3, updated_at: "2026-10-09T10:00:00Z" }] });
  });

  it("does not expose task plans or drafts", async () => {
    const response = await GET(new NextRequest(`https://local.invalid/api/assistant/status?messageId=${messageId}`));
    const body = await response.json() as { tasks: Array<Record<string, unknown>> };
    expect(body.tasks[0]).not.toHaveProperty("plan");
    expect(body.tasks[0]).not.toHaveProperty("result");
  });
});
