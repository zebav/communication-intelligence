import type { Plan, Task } from "./model";
import { sendCapability } from "./model";

// Dependency boundary makes complete approval/retry flows testable without network calls.
export async function executeApprovedTask(task: Task, revision: number, approved: boolean, deps: {
  verify: (plan: Plan) => Promise<void>;
  claim: () => Promise<Task>;
  send: (task: Task) => Promise<Record<string, unknown>>;
  finish: (claimed: Task, status: "waiting" | "uncertain", result: Record<string, unknown>) => Promise<Task>;
}) {
  if (!approved || task.status !== "ready" || task.revision !== revision) throw new Error("Granska och godkänn den senaste versionen först.");
  const reason = sendCapability(task.plan, task.kind);
  if (reason) throw new Error(reason);
  await deps.verify(task.plan);
  const claimed = await deps.claim(); // Atomic compare-and-swap, before any external side effect.
  let result: Record<string, unknown>;
  try { result = await deps.send(claimed); }
  catch {
    await deps.finish(claimed, "uncertain", { warning: "Utskickets resultat är oklart. Kontrollera Skickat hos leverantören. Försök inte skicka igen." });
    throw new Error("Resultatet behöver kontrolleras. Ingen automatisk omsändning görs.");
  }
  // If persistence fails after provider acceptance, keep the claimed task locked.
  try { return await deps.finish(claimed, "waiting", { ...result, acceptedAt: new Date().toISOString() }); }
  catch { throw new Error("Leverantören har tagit emot utskicket, men uppdragsstatus kunde inte sparas. Skicka inte igen."); }
}
