// @vitest-environment node
import { expect, it } from "vitest";
import { browserLabAction } from "./browser-lab-server";

it("runs the same approval orchestrator once with synthetic data", async () => {
  const prepared = await browserLabAction({ action: "prepare" });
  if (!prepared.approval) throw new Error("Missing fixture approval");
  const input = { action: "run", approvalId: prepared.approval.id, confirmed: true };
  const result = await browserLabAction(input);
  expect(result).toMatchObject({ simulated: true, result: { status: "read", externalSubmissionPerformed: false }, storedReceipt: { cleanup: "confirmed" } });
  await expect(browserLabAction(input)).rejects.toThrow();
});
it("does not consume approval without explicit confirmation", async () => {
  const prepared = await browserLabAction({ action: "prepare" });
  if (!prepared.approval) throw new Error("Missing fixture approval");
  await expect(browserLabAction({ action: "run", approvalId: prepared.approval.id, confirmed: false })).rejects.toThrow();
  expect(await browserLabAction({ action: "run", approvalId: prepared.approval.id, confirmed: true })).toMatchObject({ simulated: true });
});
it("rejects arbitrary external targets by never accepting a target in the test API", async () => {
  const prepared = await browserLabAction({ action: "prepare", targetUrl: "https://unapproved.example/" });
  if (!prepared.approval) throw new Error("Missing fixture approval");
  expect(prepared.approval.targetUrl).toBe("https://controlled-fixture.invalid/meeting-information");
});
