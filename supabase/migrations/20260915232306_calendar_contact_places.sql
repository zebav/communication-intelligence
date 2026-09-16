-- Internal context only. No attendee invitations and no provider event mutation.
create table public.calendar_event_context (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),
 source_id uuid not null,event_id text not null check(length(event_id) between 1 and 2000),
 person_ids uuid[] not null default '{}',conversation_id uuid references public.conversations(id),
 location_kind text not null default 'unknown' check(location_kind in ('unknown','physical','digital')),
 google_place_id text check(length(google_place_id) between 1 and 300),
 user_place_label text not null default '' check(length(user_place_label)<=500),
 meeting_url text not null default '' check(length(meeting_url)<=2000),
 revision integer not null default 1 check(revision>0),updated_at timestamptz not null default now(),
 foreign key(owner_id,source_id) references public.calendar_sources(owner_id,id),
 unique(owner_id,source_id,event_id),check(cardinality(person_ids)<=30),
 check(location_kind='physical' or google_place_id is null),
 check(location_kind='digital' or meeting_url='')
);
create index calendar_context_people on public.calendar_event_context using gin(person_ids);
alter table public.calendar_event_context enable row level security;
revoke all on public.calendar_event_context from public,anon,authenticated;
grant select,insert,update on public.calendar_event_context to authenticated;
create policy calendar_event_context_owner on public.calendar_event_context for all to authenticated
using((select auth.uid())=owner_id and (select auth.jwt()->>'aal')='aal2')
with check((select auth.uid())=owner_id and (select auth.jwt()->>'aal')='aal2');
create function public.guard_calendar_event_context() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.owner_id,new.source_id,new.event_id) is distinct from (old.owner_id,old.source_id,old.event_id) then raise exception 'Context target cannot change'; end if;
 if tg_op='INSERT' and not exists(select 1 from public.calendar_sources s where s.id=new.source_id and s.owner_id=new.owner_id and exists(select 1 from jsonb_array_elements(s.snapshot) e where e->>'id'=new.event_id)) then raise exception 'Calendar event unavailable'; end if;
 if exists(select 1 from unnest(new.person_ids) p where p is null or not exists(select 1 from public.people where id=p and owner_id=new.owner_id)) then raise exception 'Contact unavailable'; end if;
 if cardinality(new.person_ids)<>(select count(distinct p) from unnest(new.person_ids) p) then raise exception 'Duplicate contacts'; end if;
 if new.conversation_id is not null and not exists(select 1 from public.conversations where id=new.conversation_id and owner_id=new.owner_id) then raise exception 'Conversation unavailable'; end if;
 if (tg_op='INSERT' and new.revision<>1) or (tg_op='UPDATE' and new.revision<>old.revision+1) then raise exception 'Context revision mismatch'; end if;
 new.updated_at:=now();return new;
end $$;
revoke all on function public.guard_calendar_event_context() from public,anon;
create trigger guard_calendar_event_context before insert or update on public.calendar_event_context for each row execute function public.guard_calendar_event_context();
