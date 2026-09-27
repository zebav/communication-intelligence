-- Reconciled from production: workers record only operational metadata here.
alter table public.vault_ingestion_jobs
  add column if not exists metadata jsonb not null default '{}'::jsonb;
