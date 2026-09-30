-- Background workers authenticate with Supabase's server-only secret key,
-- which maps to service_role. These are the minimum table privileges needed
-- by the existing bounded workers; browser roles and RLS policies are unchanged.

grant update on table public.connections to service_role;
grant select, update on table public.scheduled_messages to service_role;
grant delete on table public.memories to service_role;
grant delete on table public.commitments to service_role;
