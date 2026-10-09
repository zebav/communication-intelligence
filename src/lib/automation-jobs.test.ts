import { describe, expect, it } from "vitest";
import { AUTOMATION_OPERATIONS, automationOperationPath, retryStatusFor, traceIdFromHeaders } from "./automation-jobs";

describe("automation job safety", () => {
  it("accepts only a well-formed propagated trace id", () => {
    const valid = "eb610f08-693f-4e9c-a5c0-a9d64550c2b8";
    expect(traceIdFromHeaders(new Headers({ "x-solvani-trace-id": valid }))).toBe(valid);
    expect(traceIdFromHeaders(new Headers({ "x-solvani-trace-id": "not-a-trace-id" }))).not.toBe("not-a-trace-id");
  });

  it("does not retry a poisoned job indefinitely", () => {
    expect(retryStatusFor({ attempts: 1 } as Parameters<typeof retryStatusFor>[0])).toBe("retrying");
    expect(retryStatusFor({ attempts: 3 } as Parameters<typeof retryStatusFor>[0])).toBe("failed");
  });

  it("routes every queued operation to a bounded existing worker", () => {
    expect(Object.values(automationOperationPath)).toHaveLength(AUTOMATION_OPERATIONS.length);
    expect(Object.values(automationOperationPath).every((path) => path.startsWith("/api/cron/"))).toBe(true);
  });
});
