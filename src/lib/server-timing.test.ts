import { describe, expect, it } from "vitest";
import { measureServerTiming, serverTimingHeader, type ServerTiming } from "./server-timing";

describe("server timing", () => {
  it("records static work names and emits a valid header", async () => {
    const timings: ServerTiming = {};
    await expect(measureServerTiming(timings, "candidates", async () => "ok")).resolves.toBe("ok");
    expect(timings.candidates).toBeTypeOf("number");
    expect(serverTimingHeader(timings)).toMatch(/^candidates;dur=\d+$/);
  });

  it("does not serialize unsafe timing names", () => {
    expect(serverTimingHeader({ "person@example.com": 10, inbox: 12 })).toBe("inbox;dur=12");
  });
});
