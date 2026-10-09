create table if not exists public.assistant_notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  task_id uuid not null references public.assistant_tasks(id) on delete cascade,
  category text not null check (category in ('critical','action_required','informational','digest')),
  state text not null default 'unread' check (state in ('unread','read','dismissed')),
  title text not null, summary text not null,
  priority smallint not null check (priority between 0 and 100),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), read_at timestamptz,
  unique(owner_id, task_id)
);
create index if not exists assistant_notifications_owner_state_idx on public.assistant_notifications(owner_id,state,priority desc,created_at desc);
alter table public.assistant_notifications enable row level security;
revoke all on public.assistant_notifications from anon;
grant select,update on public.assistant_notifications to authenticated;
grant all on public.assistant_notifications to service_role;
create policy "owners read notifications with mfa" on public.assistant_notifications for select to authenticated using ((select auth.uid())=owner_id and (select auth.jwt()->>'aal')='aal2');
create policy "owners update notifications with mfa" on public.assistant_notifications for update to authenticated using ((select auth.uid())=owner_id and (select auth.jwt()->>'aal')='aal2') with check ((select auth.uid())=owner_id and (select auth.jwt()->>'aal')='aal2');

alter table public.automation_jobs drop constraint if exists automation_jobs_operation_check;
alter table public.automation_jobs add constraint automation_jobs_operation_check check (operation in ('gmail_intelligence','outlook_intelligence','instagram_intelligence','whatsapp_intelligence','slack_intelligence','calendar_sync','vault_ingestion','relationship_backfill','autonomous_learning','follow_up_detection','notification_orchestration'));
