alter table public.automation_jobs
  drop constraint if exists automation_jobs_operation_check;
alter table public.automation_jobs
  add constraint automation_jobs_operation_check check (operation in (
    'gmail_intelligence', 'outlook_intelligence', 'instagram_intelligence',
    'whatsapp_intelligence', 'slack_intelligence', 'calendar_sync',
    'vault_ingestion', 'relationship_backfill', 'autonomous_learning',
    'follow_up_detection'
  ));

comment on table public.assistant_tasks is
  'Owner-scoped decision queue. Background detectors may only create decision-state tasks; execution remains owner-approved and revision-bound.';
