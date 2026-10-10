-- Background decision preparation uses the server-only service role.  These
-- narrow grants are deliberately separate from owner-facing RLS policies:
-- users remain owner-scoped and AAL2-gated, while the worker can only read or
-- update the specific ledgers needed to prepare a reviewable decision.

grant select on table public.communication_outcomes to service_role;
grant select, update on table public.learning_signals to service_role;
grant select, insert, update on table public.assistant_tasks to service_role;
grant insert on table public.audit_logs to service_role;
