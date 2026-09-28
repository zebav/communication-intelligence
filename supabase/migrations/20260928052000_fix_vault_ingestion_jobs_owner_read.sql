-- Allow the signed-in owner to read only their own ingestion health status.
-- Workers continue to use the service role for queue processing.
grant select on public.vault_ingestion_jobs to authenticated;

drop policy if exists vault_ingestion_jobs_owner_select on public.vault_ingestion_jobs;
create policy vault_ingestion_jobs_owner_select
  on public.vault_ingestion_jobs
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);
