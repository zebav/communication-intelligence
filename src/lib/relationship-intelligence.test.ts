import { describe, expect, it } from "vitest";
import { categoryForLegacyRelationship, scoreRelationship } from "./relationship-intelligence";

describe("Relationship Intelligence V1", () => {
  it("keeps multi-dimensional relationship scores separate", () => {
    const result = scoreRelationship({ category: "customers", categoryConfidence: 0.9, manualPriority: 9, now: new Date("2026-10-04T12:00:00Z"), signals: [
      { type: "interaction", score: 80, confidence: 0.9, observedAt: "2026-10-03T10:00:00Z", sourceType: "message", sourceId: "1", summary: "Recent customer message" },
      { type: "reciprocity", score: 60, confidence: 0.8, observedAt: "2026-10-03T10:00:00Z", sourceType: "conversation", sourceId: "c", summary: "Two-way exchange" },
      { type: "reliability", score: 70, confidence: 0.8, observedAt: "2026-10-02T10:00:00Z", sourceType: "commitment", sourceId: "x", summary: "Open commitment" },
    ] });
    expect(result.priorityScore).toBeGreaterThan(result.strengthScore);
    expect(result.rankingScore).toBeGreaterThan(0);
  });

  it("does not reward missing evidence", () => {
    const result = scoreRelationship({ category: "romantic", categoryConfidence: 0.9, signals: [] });
    expect(result.confidence).toBe(0);
    expect(result.rankingScore).toBeLessThan(40);
    expect(result.missingInformation.length).toBeGreaterThan(1);
  });

  it("maps legacy verified relationship types without changing them", () => {
    expect(categoryForLegacyRelationship("business_partner")).toBe("business_partners");
    expect(categoryForLegacyRelationship("dating")).toBe("romantic");
    expect(categoryForLegacyRelationship("unknown")).toBeNull();
  });
});
