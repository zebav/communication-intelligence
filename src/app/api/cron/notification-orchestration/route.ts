import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { ownerIdFromCronHeaders } from "@/lib/cron-owner";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = createAdminClient(), ownerId = ownerIdFromCronHeaders(request.headers);
  // `uncertain` is also an owner-facing decision: a provider may have
  // received a request but its final state could not be verified. It must not
  // disappear merely because it is not ready for another execution attempt.
  let query = db.from("assistant_tasks").select("id,owner_id,kind,status,plan,created_at").in("status", ["decision", "ready", "uncertain"]).order("updated_at", { ascending: false }).limit(40);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { data: tasks, error } = await query;
  if (error) return NextResponse.json({ error: "Decision queue unavailable." }, { status: 503 });
  const rows = (tasks ?? []).map((task) => {
    const plan = task.plan && typeof task.plan === "object" && !Array.isArray(task.plan) ? task.plan as Record<string, unknown> : {};
    const evidence = plan.evidence && typeof plan.evidence === "object" && !Array.isArray(plan.evidence) ? plan.evidence as Record<string, unknown> : {};
    const priority = Math.max(0, Math.min(100, Math.round(Number(evidence.priority ?? 5) * 10)));
    return { owner_id: task.owner_id, task_id: task.id, category: priority >= 85 ? "critical" : "action_required", title: String(evidence.title || "Ett beslut behöver din uppmärksamhet").slice(0, 240), summary: String(plan.reason || "Solvani har förberett ett beslut. Granska innan något genomförs.").slice(0, 600), priority };
  });
  if (rows.length) await db.from("assistant_notifications").upsert(rows, { onConflict: "owner_id,task_id", ignoreDuplicates: true });
  return NextResponse.json({ ok: true, synchronized: rows.length }, { headers: { "Cache-Control": "no-store" } });
}
