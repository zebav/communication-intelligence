-- Calendar credentials and snapshots are separate from existing mail connections.
create table public.calendar_accounts (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 provider text not null check(provider in ('google','microsoft')), external_id text not null,
 address text not null, scopes text[] not null, encrypted_credentials text not null,
 created_at timestamptz not null default now(), unique(owner_id,provider,external_id), unique(owner_id,id)
);
create table public.calendar_sources (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 account_id uuid not null, external_id text not null, name text not null, timezone text not null default 'UTC',
 is_master boolean not null default false, enabled boolean not null default true,
 snapshot jsonb not null default '[]' check(jsonb_typeof(snapshot)='array'),
 synced_at timestamptz, window_start timestamptz, window_end timestamptz,
 reviewed_snapshot jsonb, sync_error text,
 foreign key(owner_id,account_id) references public.calendar_accounts(owner_id,id),
 unique(owner_id,account_id,external_id), unique(owner_id,id)
);
create unique index one_master_per_owner on public.calendar_sources(owner_id) where is_master;
create table public.calendar_workspace (
 owner_id uuid primary key references auth.users(id), timezone text not null default 'Europe/Stockholm',
 provisioning text not null default 'idle' check(provisioning in ('idle','creating','ready','uncertain')),
 created_at timestamptz not null default now()
);
create table public.calendar_holds (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 title text not null check(length(title) between 1 and 300),
 starts_at timestamptz not null, ends_at timestamptz not null,
 preparation_minutes integer not null default 10 check(preparation_minutes between 0 and 180),
 recovery_minutes integer not null default 10 check(recovery_minutes between 0 and 180),
 expires_at timestamptz not null default(now()+interval '20 minutes'),
 status text not null default 'active' check(status in ('active','released','executing','confirmed')),
 conversation_id uuid, external_event_id text, created_at timestamptz not null default now(),
 check(ends_at>starts_at and ends_at<=starts_at+interval '24 hours'),
 check(expires_at<=created_at+interval '30 minutes')
);
create index calendar_holds_owner_time on public.calendar_holds(owner_id,starts_at,ends_at);
create index calendar_sources_owner_account on public.calendar_sources(owner_id,account_id);

do $$ declare t text; begin
 foreach t in array array['calendar_accounts','calendar_sources','calendar_workspace','calendar_holds'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select,insert,update on public.%I to authenticated',t);
 execute format('create policy calendar_owner on public.%I for all to authenticated using ((select auth.uid())=owner_id and (select auth.jwt()->>''aal'')=''aal2'') with check ((select auth.uid())=owner_id and (select auth.jwt()->>''aal'')=''aal2'')',t);
 end loop;
end $$;

-- Serialize holds per owner, including API clients bypassing the UI.
create function public.guard_calendar_hold() returns trigger language plpgsql security invoker set search_path='' as $$
declare s record; e jsonb; b timestamptz; f timestamptz;
begin
 if new.owner_id is distinct from auth.uid() or coalesce(auth.jwt()->>'aal','')<>'aal2' then raise exception 'MFA required'; end if;
 if tg_op='UPDATE' and (new.owner_id<>old.owner_id or new.starts_at<>old.starts_at or new.ends_at<>old.ends_at or new.preparation_minutes<>old.preparation_minutes or new.recovery_minutes<>old.recovery_minutes or new.title<>old.title or new.expires_at<>old.expires_at or new.conversation_id is distinct from old.conversation_id) then raise exception 'Create a new hold to change a proposal'; end if;
 perform 1 from public.calendar_workspace where owner_id=new.owner_id for update;
 if not found then raise exception 'Calendar workspace unavailable'; end if;
 if new.conversation_id is not null and not exists(select 1 from public.conversations where id=new.conversation_id and owner_id=new.owner_id) then raise exception 'Conversation unavailable'; end if;
 if new.status in ('released','confirmed') then return new; end if;
 if new.starts_at<=now() or (new.status='active' and new.expires_at<=now()) then raise exception 'Reservation expired'; end if;
 b:=new.starts_at-make_interval(mins=>new.preparation_minutes); f:=new.ends_at+make_interval(mins=>new.recovery_minutes);
 if not exists(select 1 from public.calendar_sources where owner_id=new.owner_id and is_master and enabled) then raise exception 'Master calendar missing'; end if;
 for s in select * from public.calendar_sources where owner_id=new.owner_id and enabled loop
  if s.synced_at is null or s.synced_at<now()-interval '5 minutes' or s.sync_error is not null or s.window_start>b or s.window_end<f or s.window_start is null or s.window_end is null then raise exception 'Fresh complete calendar sync required'; end if;
  if not s.is_master and s.reviewed_snapshot is distinct from s.snapshot then raise exception 'Review external commitments first'; end if;
  if s.is_master then
   for e in select value from jsonb_array_elements(s.snapshot) loop
    if coalesce((e->>'blocksAvailability')::boolean,true) and e->>'status'<>'cancelled' and (e->>'start')::timestamptz<f and (e->>'end')::timestamptz>b and (e->>'id') is distinct from new.external_event_id then raise exception 'Master calendar conflict'; end if;
   end loop;
  end if;
 end loop;
 if exists(select 1 from public.calendar_holds h where h.owner_id=new.owner_id and h.id<>new.id and (h.status in ('executing','confirmed') or (h.status='active' and h.expires_at>now())) and h.starts_at-make_interval(mins=>h.preparation_minutes)<f and h.ends_at+make_interval(mins=>h.recovery_minutes)>b) then raise exception 'Reservation conflict'; end if;
 return new;
end $$;
revoke all on function public.guard_calendar_hold() from public,anon;
create trigger guard_calendar_hold before insert or update on public.calendar_holds for each row execute function public.guard_calendar_hold();

create table public.calendar_activity (
 id bigint generated always as identity primary key,owner_id uuid not null references auth.users(id),
 object_type text not null,object_id uuid not null,operation text not null,
 previous_status text,new_status text,created_at timestamptz not null default now()
);
alter table public.calendar_activity enable row level security;
revoke all on public.calendar_activity from anon,authenticated;
grant select,insert on public.calendar_activity to authenticated;
grant usage on sequence public.calendar_activity_id_seq to authenticated;
create policy calendar_activity_owner on public.calendar_activity for all to authenticated
using ((select auth.uid())=owner_id and (select auth.jwt()->>'aal')='aal2')
with check ((select auth.uid())=owner_id and (select auth.jwt()->>'aal')='aal2');
create index calendar_activity_owner_date on public.calendar_activity(owner_id,created_at desc);
create function public.log_calendar_hold() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 insert into public.calendar_activity(owner_id,object_type,object_id,operation,previous_status,new_status)
 values(new.owner_id,'reservation',new.id,tg_op,case when tg_op='UPDATE' then old.status else null end,new.status);
 return new;
end $$;
revoke all on function public.log_calendar_hold() from public,anon;
create trigger log_calendar_hold after insert or update on public.calendar_holds for each row execute function public.log_calendar_hold();
