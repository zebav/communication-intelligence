import "server-only";
import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Prefer the JWT service-role key when both generations of Supabase server
  // keys are present. It is the key whose RLS-bypass behaviour is required by
  // unauthenticated provider webhooks.
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("Supabase server access is not configured.");
  return createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
}
