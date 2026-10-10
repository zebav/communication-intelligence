import { describe, expect, it } from "vitest";
import { databaseQueryFailureCode, learningQueryFailureCode } from "./learning-diagnostics";

describe("learningQueryFailureCode", () => {
  it("keeps database diagnostics private and actionable", () => {
    expect(learningQueryFailureCode({ code: "PGRST204", message: "private column" })).toBe("learning_schema_mismatch");
    expect(learningQueryFailureCode({ code: "42501", message: "owner id" })).toBe("learning_permission_denied");
    expect(learningQueryFailureCode(new Error("private SQL detail"))).toBe("learning_query_failed");
  });
});

it("can categorize another background ledger without exposing its query", () => {
  expect(databaseQueryFailureCode("follow_up", { code: "42P01", message: "private relation" })).toBe("follow_up_table_missing");
});
