create table if not exists public.notification_preferences (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  in_app_enabled boolean not null default true,
  web_push_enabled boolean not null default false,
  ios_push_enabled boolean not null default false,
  quiet_hours_start time,
  quiet_hours_end time,
  timezone text not null default 'Europe/Stockholm',
  updated_at timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from anon;
grant select,insert,update on public.notification_preferences to authenticated;
create policy "owners manage notification preferences with mfa" on public.notification_preferences for all to authenticated using ((select auth.uid())=owner_id and (select auth.jwt()->>'aal')='aal2') with check ((select auth.uid())=owner_id and (select auth.jwt()->>'aal')='aal2');
