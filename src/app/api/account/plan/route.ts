import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isPlanCode, normalizePlanLimits, planDefinitions, type PlanStatus } from "@/lib/solvani/plans";

const validStatuses = new Set<PlanStatus>(["trialing", "active", "paused", "past_due", "canceled"]);

export async function GET() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Din session har gått ut. Logga in igen." }, { status: 401 });
  const { data: assurance } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.json({ error: "Tvåfaktorsautentisering krävs." }, { status: 403 });

  const { data: entitlement, error: entitlementError } = await db
    .from("account_entitlements")
    .select("plan_code,status,limits,trial_ends_at,current_period_ends_at")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (entitlementError) {
    console.error("account_plan_read_failed", { code: entitlementError.code });
    return NextResponse.json({ setupRequired: true, error: "Plan- och användningsgrunden behöver installeras." }, { status: 503 });
  }

  const planCode = isPlanCode(entitlement?.plan_code) ? entitlement.plan_code : "private_beta";
  const entitlementStatus = entitlement?.status;
  const status = validStatuses.has(entitlementStatus as PlanStatus) ? entitlementStatus as PlanStatus : "active";
  const limits = normalizePlanLimits(entitlement?.limits, planCode);
  const periodStart = new Date(); periodStart.setUTCDate(1); periodStart.setUTCHours(0, 0, 0, 0);
  const { data: usage, error: usageError } = await db
    .from("assistant_usage_ledger")
    .select("metric,quantity")
    .eq("owner_id", user.id)
    .gte("occurred_at", periodStart.toISOString());
  if (usageError) {
    console.error("account_usage_read_failed", { code: usageError.code });
    return NextResponse.json({ setupRequired: true, error: "Plan- och användningsgrunden behöver installeras." }, { status: 503 });
  }
  const totals = (usage ?? []).reduce((result, item) => ({ ...result, [item.metric]: (result[item.metric] ?? 0) + Number(item.quantity ?? 0) }), {} as Record<string, number>);
  return NextResponse.json({
    plan: { code: planCode, name: planDefinitions[planCode].name, status, limits, trialEndsAt: entitlement?.trial_ends_at ?? null, currentPeriodEndsAt: entitlement?.current_period_ends_at ?? null },
    usage: { aiCredits: totals.ai_credits ?? 0, browserMinutes: totals.browser_minutes ?? 0 },
  }, { headers: { "Cache-Control": "no-store" } });
}
