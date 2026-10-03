-- Durable lifecycle for private media ingestion. Jobs that cannot safely be
-- retried are retained for a single explicit owner retry instead of looping.
alter table public.vault_ingestion_jobs
  add column if not exists failed_stage text,
  add column if not exists error_details jsonb not null default '{}'::jsonb,
  add column if not exists next_retry_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists dead_lettered_at timestamptz,
  add column if not exists manual_retry_count integer not null default 0;

alter table public.vault_ingestion_jobs
  drop constraint if exists vault_ingestion_jobs_state_check;

alter table public.vault_ingestion_jobs
  add constraint vault_ingestion_jobs_state_check
  check (state in ('pending', 'processing', 'done', 'failed', 'dead_letter'));

alter table public.vault_ingestion_jobs
  add constraint vault_ingestion_jobs_manual_retry_count_check
  check (manual_retry_count >= 0 and manual_retry_count <= 1);

create index if not exists vault_ingestion_jobs_retry_idx
  on public.vault_ingestion_jobs (state, next_retry_at, updated_at)
  where state in ('failed', 'processing');

-- Existing failed records lack stage-level diagnostics. Keep them intact but
-- terminal until a deliberately bounded owner retry is requested after deploy.
update public.vault_ingestion_jobs
set state = 'dead_letter',
    failed_stage = coalesce(failed_stage, 'unknown'),
    error_details = case when error_details = '{}'::jsonb
      then jsonb_build_object('code', coalesce(last_error_code, 'legacy_failure'), 'stage', 'unknown', 'retryable', false, 'migrated_at', now())
      else error_details end,
    dead_lettered_at = coalesce(dead_lettered_at, now()),
    next_retry_at = null,
    updated_at = now()
where state = 'failed';
