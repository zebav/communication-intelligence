create table public.calendar_event_actions (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),source_id uuid not null,
 event_id text not null,kind text not null check(kind in ('rename','cancel')),expected_etag text not null,
 before_event jsonb not null check(jsonb_typeof(before_event)='object'),new_title text,
 status text not null default 'proposed' check(status in ('proposed','executing','completed','stale')),
 created_at timestamptz not null default now(),expires_at timestamptz not null default(now()+interval '10 minutes'),
 approved_at timestamptz,completed_at timestamptz,
 foreign key(owner_id,source_id) references public.calendar_sources(owner_id,id),
 check((kind='cancel' and new_title is null) or (kind='rename' and new_title is not null and length(new_title) between 1 and 300))
);
create index calendar_event_actions_owner_date on public.calendar_event_actions(owner_id,created_at desc);
create unique index calendar_event_actions_executing on public.calendar_event_actions(owner_id,source_id,event_id) where status='executing';
alter table public.calendar_event_actions enable row level security;
revoke all on public.calendar_event_actions from public,anon,authenticated;
grant select,insert,update on public.calendar_event_actions to authenticated;
create policy calendar_event_actions_owner on public.calendar_event_actions for all to authenticated
using((select auth.uid())=owner_id and (select auth.jwt()->>'aal')='aal2')
with check((select auth.uid())=owner_id and (select auth.jwt()->>'aal')='aal2');
create function public.guard_calendar_event_action() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.calendar_sources where id=new.source_id and owner_id=new.owner_id and is_master) then raise exception 'Only master events may be changed'; end if;
 if tg_op='INSERT' and (new.status<>'proposed' or new.expires_at>now()+interval '10 minutes') then raise exception 'Review required'; end if;
 if tg_op='UPDATE' then
  if (new.owner_id,new.source_id,new.event_id,new.kind,new.expected_etag,new.before_event,new.new_title,new.expires_at) is distinct from (old.owner_id,old.source_id,old.event_id,old.kind,old.expected_etag,old.before_event,old.new_title,old.expires_at) then raise exception 'Action facts cannot change'; end if;
  if new.status<>old.status and not ((old.status='proposed' and new.status in ('executing','stale')) or (old.status='executing' and new.status in ('completed','stale'))) then raise exception 'Invalid action transition'; end if;
  if new.status='executing' and old.status='proposed' and (new.expires_at<=now() or new.approved_at is null) then raise exception 'Approval expired'; end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_calendar_event_action() from public,anon;
create trigger guard_calendar_event_action before insert or update on public.calendar_event_actions for each row execute function public.guard_calendar_event_action();
