-- Meta calls the Instagram webhook without an end-user Supabase session.
-- The server-only service role therefore needs explicit PostgreSQL privileges
-- for the ingestion and asynchronous intelligence pipeline. RLS bypass remains
-- limited to that server role; authenticated and anonymous grants are unchanged.
grant usage on schema public to service_role;

grant select on table public.profiles to service_role;
grant select on table public.connections to service_role;

grant select, insert, update on table public.people to service_role;
grant select, insert, update on table public.identities to service_role;
grant select, insert, update on table public.conversations to service_role;
grant select, insert, update on table public.messages to service_role;
grant select, insert, update on table public.memories to service_role;
grant select, insert, update on table public.commitments to service_role;
