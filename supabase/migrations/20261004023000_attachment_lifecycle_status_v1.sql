-- Attachment retrieval, analysis and retention are separate owner-visible states.
-- Existing rows are backfilled conservatively from their durable job state.
alter table public.vault_ingestion_jobs
  add column if not exists retrieval_status text not null default 'queued',
  add column if not exists analysis_status text not null default 'not_started',
  add column if not exists vault_status text not null default 'not_evaluated';

alter table public.vault_ingestion_jobs
  drop constraint if exists vault_ingestion_jobs_retrieval_status_check,
  add constraint vault_ingestion_jobs_retrieval_status_check check (retrieval_status in ('queued','fetching','available','failed','expired','unsupported')),
  drop constraint if exists vault_ingestion_jobs_analysis_status_check,
  add constraint vault_ingestion_jobs_analysis_status_check check (analysis_status in ('not_started','queued','processing','completed','failed','blocked')),
  drop constraint if exists vault_ingestion_jobs_vault_status_check,
  add constraint vault_ingestion_jobs_vault_status_check check (vault_status in ('not_evaluated','retained','rejected','failed'));

update public.vault_ingestion_jobs
set retrieval_status = case when state = 'done' then 'available' when state in ('failed','dead_letter') then 'failed' when state = 'processing' then 'fetching' else 'queued' end,
    analysis_status = case when state = 'done' then 'completed' when state in ('failed','dead_letter') then 'failed' when state = 'processing' then 'processing' else 'queued' end,
    vault_status = case when state = 'done' then 'retained' when state in ('failed','dead_letter') then 'failed' else 'not_evaluated' end
where retrieval_status = 'queued' and analysis_status = 'not_started' and vault_status = 'not_evaluated';

create index if not exists vault_ingestion_jobs_owner_lifecycle_idx
  on public.vault_ingestion_jobs(owner_id, retrieval_status, analysis_status, vault_status, updated_at desc);
