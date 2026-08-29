import { describe, expect, it } from "vitest";
import { calculateAttention, recommendAction } from "./domain";

describe("attention engine", () => {
  it("adds transparent dimensions to the neutral baseline", () => expect(calculateAttention([{ label: "Urgency", value: 1.4, reason: "due" }, { label: "Effort", value: -0.3, reason: "work" }])).toBe(6.1));
  it("clamps scores to the 1–10 range", () => { expect(calculateAttention([{ label: "Risk", value: 99, reason: "test" }])).toBe(10); expect(calculateAttention([{ label: "Spam", value: -99, reason: "test" }])).toBe(1); });
  it("prioritizes decisions over score thresholds", () => expect(recommendAction(4, true)).toBe("DECISION_REQUIRED"));
  it("recommends ignoring low-value messages", () => expect(recommendAction(2.5)).toBe("IGNORE"));
});
