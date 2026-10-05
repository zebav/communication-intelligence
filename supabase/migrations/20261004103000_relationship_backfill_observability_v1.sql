-- Relationship backfills are long-running and user-visible. These fields make
-- progress and recovery auditable without storing any message content.
alter table public.relationship_backfill_jobs
  add column if not exists total_people integer,
  add column if not exists current_stage text not null default 'queued'
    check (current_stage in ('queued', 'qualifying_people', 'extracting_signals', 'scoring', 'completed', 'paused', 'failed', 'cancelled')),
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists last_error_code text;

alter table public.relationship_backfill_jobs
  drop constraint if exists relationship_backfill_jobs_total_people_check;
alter table public.relationship_backfill_jobs
  add constraint relationship_backfill_jobs_total_people_check
  check (total_people is null or total_people >= 0);

create index if not exists relationship_backfill_jobs_active_progress_idx
  on public.relationship_backfill_jobs(owner_id, status, updated_at desc)
  where status in ('pending', 'running', 'paused');

comment on column public.relationship_backfill_jobs.total_people is 'Stable count of eligible people when a historical relationship analysis starts.';
comment on column public.relationship_backfill_jobs.current_stage is 'Non-sensitive progress stage for the owner-facing operations view.';
