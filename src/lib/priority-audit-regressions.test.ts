import { expect, it } from "vitest";
import { priorityV3 } from "./priority-v3";
// Synthetic counterparts, not private production message content.
it.each(["Win tickets tonight!", "Buy cinema vouchers", "Discount flights from 299 SEK"])("does not treat promotional copy as an urgent task: %s", text => {
  expect(priorityV3({ text, classification: "Marketing", basePriority: 10, unread: true }).score).toBe(2);
});
it("retains explicit owner priority rule even for a campaign", () => {
  expect(priorityV3({ classification: "Newsletter", basePriority: 10, handlingRule: "always_priority" }).score).toBe(8.5);
});
