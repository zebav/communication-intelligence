import { expect, it } from "vitest";
import { sentStatus } from "./sent-status";
it("does not invent delivery or expected reply", () => {
  expect(sentStatus({}, "2026-09-15T10:00:00Z")).toEqual({ status: "sent", reply: "unknown" });
  expect(sentStatus({ delivery_status: "delivered", expects_reply: true }, "2026-09-15T10:00:00Z")).toEqual({ status: "delivered", reply: "waiting" });
});
it("recognizes a later incoming message rather than an old one", () => {
  expect(sentStatus({}, "2026-09-15T10:00:00Z", "2026-09-15T11:00:00Z").reply).toBe("received");
  expect(sentStatus({}, "2026-09-15T10:00:00Z", "2026-09-14T11:00:00Z").reply).toBe("unknown");
});
