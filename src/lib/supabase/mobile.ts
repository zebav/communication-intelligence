import { createClient } from "@supabase/supabase-js";

/** A request-scoped Supabase client for the signed-in native app. The token is
 * never stored by the web server and RLS remains the authorization boundary. */
export function createMobileClient(accessToken: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
