import { z } from "zod";

const approvalSchema = z.object({
  id: z.string().uuid(), ownerId: z.string().uuid(), taskId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  mode: z.literal("read_only"), status: z.literal("approved"),
  targetUrl: z.string().url(), approvedUrls: z.array(z.string().url()).min(1).max(50),
  approvedAt: z.iso.datetime({ offset: true }), expiresAt: z.iso.datetime({ offset: true }),
}).strict();
export type BrowserApproval = z.infer<typeof approvalSchema>;
const resultSchema = z.object({
  status: z.enum(["read", "failed"]), text: z.string().max(100_000).nullable(),
  cleanup: z.enum(["confirmed", "needs_review"]), externalSubmissionPerformed: z.literal(false),
}).strict();
export type BrowserReadResult = z.infer<typeof resultSchema>;

/** Server-only orchestration contract. Authentication and stored approval must come from
 * trusted server adapters, never request-body claims or text extracted from a website.
 * claim must atomically compare the ENTIRE approval with storage, check its expiry and
 * task revision, then consume it exactly once. Production execution remains disabled.
 */
export async function executeApprovedBrowserRead(input: { approvalId: string; taskId: string; revision: number }, deps: {
  authenticate: () => Promise<{ userId: string; aal: string }>;
  load: (id: string, ownerId: string) => Promise<unknown>;
  claim: (approval: Readonly<BrowserApproval>, now: number) => Promise<boolean>;
  run: (input: { requestId: string; targetUrl: string; approvedUrls: readonly string[] }) => Promise<unknown>;
  finish: (approval: Readonly<BrowserApproval>, status: "waiting" | "uncertain", result: BrowserReadResult) => Promise<void>;
  now?: () => number;
}) {
  const request = z.object({ approvalId: z.string().uuid(), taskId: z.string().uuid(), revision: z.number().int().nonnegative() }).parse(input);
  const actor = await deps.authenticate();
  if (actor.aal !== "aal2" || !z.string().uuid().safeParse(actor.userId).success) throw new Error("Bekräfta din inloggning först.");
  const approval = approvalSchema.parse(await deps.load(request.approvalId, actor.userId));
  const now = (deps.now ?? Date.now)();
  if (!Number.isFinite(now) || approval.id !== request.approvalId || approval.ownerId !== actor.userId || approval.taskId !== request.taskId || approval.revision !== request.revision || Date.parse(approval.approvedAt) > now || Date.parse(approval.expiresAt) <= now || Date.parse(approval.expiresAt) <= Date.parse(approval.approvedAt)) throw new Error("Granska och godkänn den aktuella webbuppgiften igen.");
  for (const raw of approval.approvedUrls) {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("Godkännandet innehåller en otillåten adress.");
  }
  if (!approval.approvedUrls.includes(approval.targetUrl)) throw new Error("Måladressen omfattas inte av godkännandet.");
  const targetUrl = approval.targetUrl;
  const approvedUrls = Object.freeze([...approval.approvedUrls]);
  Object.freeze(approval.approvedUrls);
  Object.freeze(approval);
  if (!await deps.claim(approval, now)) throw new Error("Godkännandet är ändrat, förbrukat eller används redan.");
  // Never release/retry approval after an uncertain external result.
  let result: BrowserReadResult;
  try {
    result = resultSchema.parse(await deps.run({ requestId: approval.id, targetUrl, approvedUrls }));
    if (result.status === "read" && result.text === null) throw new Error("Missing read result");
    if (result.status === "failed") result.text = null;
  } catch {
    result = { status: "failed", text: null, cleanup: "needs_review", externalSubmissionPerformed: false };
  }
  // Reading a page never completes the user's original task.
  const status = result.status === "read" && result.cleanup === "confirmed" ? "waiting" : "uncertain";
  try { await deps.finish(approval, status, result); }
  catch { throw new Error("Resultatet kunde inte sparas. Uppgiften är låst; starta inte om den."); }
  return result;
}
