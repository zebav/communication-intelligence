import { randomUUID } from "node:crypto";
import { executeApprovedBrowserRead, type BrowserApproval } from "../src/lib/assistant/browser-approval";

// Isolated in-memory harness: no credentials, database, provider or outbound network.
const ownerId = "10000000-0000-4000-8000-000000000001";
const taskId = "10000000-0000-4000-8000-000000000002";
const targetUrl = "https://controlled-fixture.invalid/meeting-information";
const approvals = new Map<string, BrowserApproval>();
const consumed = new Set<string>();
const receipts = new Map<string, unknown>();
export async function browserLabAction(body: Record<string, unknown>) {
  if (body.action === "prepare") {
    const approval: BrowserApproval = { id: randomUUID(), ownerId, taskId, revision: 1, mode: "read_only", status: "approved", targetUrl, approvedUrls: [targetUrl], approvedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
    if (approvals.size >= 100) throw new Error("Starta om det lokala testet för att tömma testdata.");
    approvals.set(approval.id, approval);
    return { approval, simulated: true };
  }
  if (body.action !== "run" || body.confirmed !== true || typeof body.approvalId !== "string") throw new Error("Ett uttryckligt testgodkännande krävs.");
  const result = await executeApprovedBrowserRead({ approvalId: body.approvalId, taskId, revision: 1 }, {
    authenticate: async () => ({ userId: ownerId, aal: "aal2" }), // synthetic actor, not real authentication
    load: async id => approvals.get(id),
    claim: async approval => { if (consumed.has(approval.id)) return false; consumed.add(approval.id); return true; },
    run: async () => ({ status: "read", text: "KONTROLLERAT TESTUNDERLAG\nMöteslokalen öppnar kl. 09.00. Ta med legitimation.\n\nIngen webbplats besöktes och inga uppgifter skickades.", cleanup: "confirmed", externalSubmissionPerformed: false }),
    finish: async (approval, status, receipt) => { receipts.set(approval.id, { taskStatus: status, ...receipt }); },
  });
  return { result, storedReceipt: receipts.get(body.approvalId), simulated: true };
}
