import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const runEmailIntelligence = vi.hoisted(() => vi.fn());

vi.mock("../outlook-intelligence/route", () => ({ GET: runEmailIntelligence }));

import { GET } from "./route";

describe("Gmail intelligence cron wrapper", () => {
  it("retains the signed owner-maintenance context when selecting Gmail", async () => {
    runEmailIntelligence.mockResolvedValue(NextResponse.json({ ok: true }));
    const request = new NextRequest("https://www.solvani.app/api/cron/gmail-intelligence", {
      headers: {
        authorization: "Bearer cron-secret",
        "x-owner-id": "11111111-1111-4111-8111-111111111111",
        "x-maintenance-trigger": "queued",
      },
    });

    await GET(request);

    const forwarded = runEmailIntelligence.mock.calls[0]?.[0] as NextRequest;
    expect(forwarded.nextUrl.searchParams.get("provider")).toBe("gmail");
    expect(forwarded.headers.get("authorization")).toBe("Bearer cron-secret");
    expect(forwarded.headers.get("x-owner-id")).toBe("11111111-1111-4111-8111-111111111111");
    expect(forwarded.headers.get("x-maintenance-trigger")).toBe("queued");
  });
});
