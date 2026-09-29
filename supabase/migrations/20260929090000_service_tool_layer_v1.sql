-- Service & Tool Layer V1: owner-controlled operating boundaries and server-only audit history.

create table if not exists public.assistant_service_policies (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  service_id text not null check (service_id in ('gmail','outlook','instagram','whatsapp','slack','google_calendar','outlook_calendar','google_maps','google_drive','onedrive','browserbase')),
  permission text not null default 'prepare' check (permission in ('off', 'read', 'suggest', 'prepare')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, service_id)
);

create table if not exists public.assistant_service_audit_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  service_id text not null,
  event_type text not null check (event_type in ('policy_changed','connection_checked','action_prepared','action_executed','action_blocked')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists assistant_service_audit_events_owner_time_idx on public.assistant_service_audit_events(owner_id, created_at desc);

alter table public.assistant_service_policies enable row level security;
alter table public.assistant_service_audit_events enable row level security;
revoke all on public.assistant_service_policies, public.assistant_service_audit_events from public, anon;
grant select, insert, update on public.assistant_service_policies to authenticated;
grant select on public.assistant_service_audit_events to authenticated;
grant all on public.assistant_service_audit_events to service_role;

drop policy if exists assistant_service_policies_owner_read on public.assistant_service_policies;
create policy assistant_service_policies_owner_read on public.assistant_service_policies for select to authenticated
  using (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2');
drop policy if exists assistant_service_policies_owner_insert on public.assistant_service_policies;
create policy assistant_service_policies_owner_insert on public.assistant_service_policies for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2');
drop policy if exists assistant_service_policies_owner_update on public.assistant_service_policies;
create policy assistant_service_policies_owner_update on public.assistant_service_policies for update to authenticated
  using (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2')
  with check (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2');
drop policy if exists assistant_service_audit_events_owner_read on public.assistant_service_audit_events;
create policy assistant_service_audit_events_owner_read on public.assistant_service_audit_events for select to authenticated
  using (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2');

comment on table public.assistant_service_policies is 'Owner-selected ceilings only. Execution must separately check the service catalog, task risk and an approval claim.';
comment on table public.assistant_service_audit_events is 'Append-only server-side service audit. Clients cannot create or alter audit records.';
