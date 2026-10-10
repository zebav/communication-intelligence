import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./bounded-concurrency";

describe("mapWithConcurrency", () => {
  it("preserves result order while bounding parallel provider work", async () => {
    let inFlight = 0;
    let peak = 0;
    const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return value * 10;
    });

    expect(result).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("does not start more workers than values", async () => {
    await expect(mapWithConcurrency(["one"], 10, async (value) => value)).resolves.toEqual(["one"]);
  });
});
