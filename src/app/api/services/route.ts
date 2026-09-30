import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serviceById, servicePermissionAtMost, serviceSnapshots, type ServicePermission } from "@/lib/services/catalog";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const policySchema = z.object({ serviceId: z.string().min(1).max(80), permission: z.enum(["off", "read", "suggest", "prepare"]), enabled: z.boolean() });

async function authenticatedDatabase() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Din session har gått ut. Logga in igen." }, { status: 401 }) };
  const { data: assurance } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return { error: NextResponse.json({ error: "Tvåstegsverifiering krävs." }, { status: 403 }) };
  return { db, user };
}

export async function GET() {
  const session = await authenticatedDatabase();
  if ("error" in session) return session.error;
  const [connections, policies, calendarAccounts] = await Promise.all([
    session.db.from("connections").select("id,provider,source,account_name,account_identifier,status,health_status,last_sync_at").eq("owner_id", session.user.id),
    session.db.from("assistant_service_policies").select("service_id,permission,enabled,updated_at").eq("owner_id", session.user.id),
    session.db.from("calendar_accounts").select("provider,address,created_at").eq("owner_id", session.user.id),
  ]);
  if (connections.error) return NextResponse.json({ error: "Anslutningarna kunde inte läsas." }, { status: 500 });
  const policiesUnavailable = Boolean(policies.error);
  return NextResponse.json({
    services: serviceSnapshots({ connections: (connections.data ?? []).map((item) => ({ id: item.id, provider: item.provider, source: item.source ?? undefined, accountName: item.account_name ?? undefined, accountIdentifier: item.account_identifier ?? undefined, status: item.status, healthStatus: item.health_status, lastSyncAt: item.last_sync_at ?? undefined, capabilities: {} })), calendars: calendarAccounts.error ? [] : (calendarAccounts.data ?? []).filter((item): item is { provider: "google" | "microsoft"; address: string; created_at: string } => item.provider === "google" || item.provider === "microsoft").map((item) => ({ provider: item.provider, address: item.address, lastSyncAt: item.created_at })), policies: policies.error ? [] : policies.data as { service_id: string; permission: ServicePermission; enabled: boolean; updated_at: string | null }[], environment: process.env }),
    policiesUnavailable,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const session = await authenticatedDatabase();
  if ("error" in session) return session.error;
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Ogiltigt ursprung." }, { status: 403 });
  const parsed = policySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ogiltiga tjänsteinställningar." }, { status: 400 });
  const service = serviceById(parsed.data.serviceId);
  if (!service || !servicePermissionAtMost(parsed.data.permission, service.maxPermission)) return NextResponse.json({ error: "Den valda behörigheten är inte tillåten för tjänsten." }, { status: 400 });
  const { error } = await session.db.from("assistant_service_policies").upsert({ owner_id: session.user.id, service_id: service.id, permission: parsed.data.permission, enabled: parsed.data.enabled }, { onConflict: "owner_id,service_id" });
  if (error) return NextResponse.json({ error: "Service & Tool Layer-databasen behöver installeras innan inställningen kan sparas." }, { status: 503 });
  try { await createAdminClient().from("assistant_service_audit_events").insert({ owner_id: session.user.id, service_id: service.id, event_type: "policy_changed", details: { permission: parsed.data.permission, enabled: parsed.data.enabled } }); } catch { /* Policy remains valid even if optional audit write cannot be recorded. */ }
  return NextResponse.json({ ok: true });
}
