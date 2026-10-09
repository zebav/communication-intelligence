-- Durable, owner-scoped orchestration for bounded maintenance work.
-- This records only operational metadata: never message content, credentials,
-- attachment bytes, addresses or provider responses.

create table if not exists public.automation_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  operation text not null check (operation in (
    'gmail_intelligence', 'outlook_intelligence', 'instagram_intelligence',
    'whatsapp_intelligence', 'slack_intelligence', 'calendar_sync',
    'vault_ingestion', 'relationship_backfill'
  )),
  trigger text not null check (trigger in ('login', 'scheduled', 'manual_recovery')),
  status text not null default 'queued' check (status in ('queued', 'running', 'retrying', 'completed', 'failed', 'cancelled')),
  trace_id uuid not null,
  idempotency_key text not null,
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 3),
  available_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, operation, idempotency_key)
);

create index if not exists automation_jobs_dispatch_idx
  on public.automation_jobs (status, available_at, created_at);
create index if not exists automation_jobs_owner_updated_idx
  on public.automation_jobs (owner_id, updated_at desc);
create index if not exists automation_jobs_trace_idx
  on public.automation_jobs (trace_id, created_at desc);

alter table public.automation_jobs enable row level security;
revoke all on public.automation_jobs from anon;
revoke insert, update, delete on public.automation_jobs from authenticated;
grant select on public.automation_jobs to authenticated;
grant all on public.automation_jobs to service_role;

create policy "owners read automation jobs with mfa"
  on public.automation_jobs for select to authenticated
  using ((select auth.uid()) = owner_id and (select auth.jwt() ->> 'aal') = 'aal2');

comment on table public.automation_jobs is
  'Owner-scoped, privacy-safe maintenance queue. Rows contain operational state only; no communication content, provider tokens or attachment bytes.';
