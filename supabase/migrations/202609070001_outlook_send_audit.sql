-- A signed-in, MFA-verified owner may record their own outbound actions.
-- The application stores identifiers and timestamps here, never message bodies.
grant select, insert on table public.audit_logs to authenticated;

create policy "owners insert own audit logs"
on public.audit_logs
for insert
to authenticated
with check (
  owner_id = auth.uid()
  and actor_id = auth.uid()
  and actor_type = 'user'
  and source = 'email'
);
