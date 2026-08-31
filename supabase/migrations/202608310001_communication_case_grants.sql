-- RLS decides which owner-scoped rows an MFA-verified user may access.
-- PostgreSQL table privileges must also allow the authenticated role to reach
-- the policies. Keep these grants limited to the Milestone 2 case workflow.
grant select, insert, delete on table public.people to authenticated;
grant select, insert, delete on table public.conversations to authenticated;
grant select, insert, delete on table public.messages to authenticated;
