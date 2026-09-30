import "server-only";
import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Supabase's current secret key replaces the legacy service-role key. Some
  // deployments retain both during key rotation, so prefer the current key
  // and keep the legacy name only as a backwards-compatible fallback.
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) throw new Error("Supabase server access is not configured.");
  return createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
}
