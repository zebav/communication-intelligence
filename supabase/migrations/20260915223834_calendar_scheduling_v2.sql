-- User-owned planning rules; additive migration, no existing events are changed.
create table public.calendar_planning_preferences (
 owner_id uuid primary key references auth.users(id),
 rules jsonb not null check(jsonb_typeof(rules)='object'),
 updated_at timestamptz not null default now()
);
alter table public.calendar_planning_preferences enable row level security;
revoke all on public.calendar_planning_preferences from public,anon,authenticated;
grant select,insert,update on public.calendar_planning_preferences to authenticated;
create policy calendar_planning_preferences_owner on public.calendar_planning_preferences
for all to authenticated
using ((select auth.uid())=owner_id and (select auth.jwt()->>'aal')='aal2')
with check ((select auth.uid())=owner_id and (select auth.jwt()->>'aal')='aal2');

create table public.calendar_commitment_transfers (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 source_id uuid not null, source_event_id text not null,
 master_source_id uuid not null, master_event_id text not null,
 event_snapshot jsonb not null check(jsonb_typeof(event_snapshot)='object'),
 status text not null default 'pending' check(status in ('pending','executing','confirmed')),
 approved_at timestamptz not null default now(), confirmed_at timestamptz,
 foreign key(owner_id,source_id) references public.calendar_sources(owner_id,id),
 foreign key(owner_id,master_source_id) references public.calendar_sources(owner_id,id),
 unique(owner_id,source_id,source_event_id), unique(owner_id,master_source_id,master_event_id)
);
alter table public.calendar_commitment_transfers enable row level security;
revoke all on public.calendar_commitment_transfers from public,anon,authenticated;
grant select,insert,update on public.calendar_commitment_transfers to authenticated;
create policy calendar_commitment_transfers_owner on public.calendar_commitment_transfers
for all to authenticated
using ((select auth.uid())=owner_id and (select auth.jwt()->>'aal')='aal2')
with check ((select auth.uid())=owner_id and (select auth.jwt()->>'aal')='aal2');
create index calendar_transfers_master on public.calendar_commitment_transfers(owner_id,master_source_id);

-- The same workspace lock serializes copies and reservations before external writes.
create function public.guard_calendar_transfer() returns trigger language plpgsql security invoker set search_path='' as $$
declare b timestamptz; f timestamptz; m record;
begin
 if new.owner_id is distinct from auth.uid() or coalesce(auth.jwt()->>'aal','')<>'aal2' then raise exception 'MFA required'; end if;
 if tg_op='UPDATE' and (new.owner_id<>old.owner_id or new.source_id<>old.source_id or new.source_event_id<>old.source_event_id or new.master_source_id<>old.master_source_id or new.master_event_id<>old.master_event_id or new.event_snapshot<>old.event_snapshot) then raise exception 'Transfer facts cannot be changed'; end if;
 perform 1 from public.calendar_workspace where owner_id=new.owner_id for update;
 if not found then raise exception 'Calendar workspace unavailable'; end if;
 if tg_op='INSERT' and new.status<>'pending' then raise exception 'Transfer must start pending'; end if;
 if tg_op='UPDATE' and new.status<>old.status and not ((old.status='pending' and new.status='executing') or (old.status='executing' and new.status='confirmed')) then raise exception 'Invalid transfer transition'; end if;
 if new.status<>'executing' then return new; end if;
 b:=(new.event_snapshot->>'start')::timestamptz; f:=(new.event_snapshot->>'end')::timestamptz;
 if b is null or f is null or b<=now() or f<=b or new.event_snapshot->>'status'='cancelled' then raise exception 'Invalid transfer time'; end if;
 if not exists(select 1 from public.calendar_sources s where s.owner_id=new.owner_id and s.id=new.source_id and not s.is_master and s.enabled and s.synced_at>now()-interval '5 minutes' and s.sync_error is null and exists(select 1 from jsonb_array_elements(s.snapshot) e where e.value=new.event_snapshot)) then raise exception 'Source event changed'; end if;
 select * into m from public.calendar_sources where owner_id=new.owner_id and id=new.master_source_id and is_master and enabled;
 if not found or m.synced_at is null or m.synced_at<now()-interval '5 minutes' or m.sync_error is not null or m.window_start is null or m.window_end is null or m.window_start>b or m.window_end<f then raise exception 'Fresh master sync required'; end if;
 if exists(select 1 from jsonb_array_elements(m.snapshot) e where e.value->>'status'<>'cancelled' and coalesce((e.value->>'blocksAvailability')::boolean,true) and e.value->>'id'<>new.master_event_id and (e.value->>'start')::timestamptz<f and (e.value->>'end')::timestamptz>b) then raise exception 'Master calendar conflict'; end if;
 if exists(select 1 from public.calendar_commitment_transfers t where t.owner_id=new.owner_id and t.id<>new.id and t.status='executing' and (t.event_snapshot->>'start')::timestamptz<f and (t.event_snapshot->>'end')::timestamptz>b) then raise exception 'Another transfer is executing'; end if;
 if exists(select 1 from public.calendar_holds h where h.owner_id=new.owner_id and (h.status in ('executing','confirmed') or (h.status='active' and h.expires_at>now())) and h.starts_at-make_interval(mins=>h.preparation_minutes)<f and h.ends_at+make_interval(mins=>h.recovery_minutes)>b) then raise exception 'Reservation conflict'; end if;
 return new;
end $$;
revoke all on function public.guard_calendar_transfer() from public,anon;
create trigger guard_calendar_transfer before insert or update on public.calendar_commitment_transfers for each row execute function public.guard_calendar_transfer();

create function public.guard_hold_against_transfer() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.calendar_workspace where owner_id=new.owner_id for update;
 if new.status in ('active','executing') and exists(select 1 from public.calendar_commitment_transfers t where t.owner_id=new.owner_id and t.status='executing' and (t.event_snapshot->>'start')::timestamptz<new.ends_at+make_interval(mins=>new.recovery_minutes) and (t.event_snapshot->>'end')::timestamptz>new.starts_at-make_interval(mins=>new.preparation_minutes)) then raise exception 'Calendar transfer in progress'; end if;
 return new;
end $$;
revoke all on function public.guard_hold_against_transfer() from public,anon;
create trigger guard_hold_against_transfer before insert or update on public.calendar_holds for each row execute function public.guard_hold_against_transfer();
