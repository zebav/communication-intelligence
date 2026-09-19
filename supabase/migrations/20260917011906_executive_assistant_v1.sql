-- Local-only rollout. No provider calls, scheduled jobs or historic data updates.
create table public.assistant_tasks (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 message_id uuid not null references public.messages(id) on delete cascade,
 kind text not null check(kind in ('reply','forward','meeting','follow_up','website')),
 status text not null default 'decision' check(status in ('decision','ready','executing','waiting','done','dismissed','uncertain')),
 revision integer not null default 1,
 plan jsonb not null check(jsonb_typeof(plan)='object'),
 result jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,message_id,kind)
);
create index assistant_tasks_owner_status on public.assistant_tasks(owner_id,status,updated_at desc);
create table public.assistant_task_events (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
 task_id uuid not null references public.assistant_tasks(id) on delete cascade,
 revision integer not null, status text not null, details jsonb not null,
 created_at timestamptz not null default now(), unique(task_id,revision)
);
create index assistant_events_owner_task on public.assistant_task_events(owner_id,task_id,created_at);
alter table public.assistant_tasks enable row level security;
alter table public.assistant_task_events enable row level security;
revoke all on public.assistant_tasks,public.assistant_task_events from anon,authenticated;
grant select,insert,update on public.assistant_tasks to authenticated;
grant select,insert on public.assistant_task_events to authenticated;
create policy assistant_read on public.assistant_tasks for select to authenticated using(owner_id=(select auth.uid()) and (select auth.jwt()->>'aal')='aal2');
create policy assistant_insert on public.assistant_tasks for insert to authenticated with check(owner_id=(select auth.uid()) and (select auth.jwt()->>'aal')='aal2');
create policy assistant_update on public.assistant_tasks for update to authenticated using(owner_id=(select auth.uid()) and (select auth.jwt()->>'aal')='aal2') with check(owner_id=(select auth.uid()) and (select auth.jwt()->>'aal')='aal2');
create policy assistant_events_read on public.assistant_task_events for select to authenticated using(owner_id=(select auth.uid()) and (select auth.jwt()->>'aal')='aal2');
-- Event insertion is only allowed while the task trigger is running.
create policy assistant_events_insert on public.assistant_task_events for insert to authenticated with check(owner_id=(select auth.uid()) and (select auth.jwt()->>'aal')='aal2' and pg_trigger_depth()>0);
create function public.assistant_task_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.messages m where m.id=new.message_id and m.owner_id=new.owner_id) then raise exception 'Message ownership mismatch'; end if;
 if tg_op='INSERT' then
  if new.status<>'decision' or new.revision<>1 then raise exception 'New tasks require review'; end if;
 else
  if new.owner_id<>old.owner_id or new.message_id<>old.message_id or new.kind<>old.kind or new.created_at<>old.created_at then raise exception 'Immutable task identity'; end if;
  if not ((old.status='decision' and new.status in ('decision','ready','dismissed','done')) or
    (old.status='ready' and new.status in ('decision','ready','executing','dismissed','done')) or
    (old.status='executing' and new.status in ('waiting','uncertain','done')) or
    (old.status='waiting' and new.status in ('decision','done','dismissed')) or
    (old.status='uncertain' and new.status='done')) then raise exception 'Task transition rejected'; end if;
  if new.plan<>old.plan and new.status not in ('decision','ready') then raise exception 'Approved plan is immutable'; end if;
  new.revision=old.revision+1;
 end if;
 new.updated_at=now();
 return new;
end $$;
create function public.assistant_task_audit() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 insert into public.assistant_task_events(owner_id,task_id,revision,status,details)
 values(new.owner_id,new.id,new.revision,new.status,jsonb_build_object('plan',new.plan,'result',new.result));
 return new;
end $$;
revoke all on function public.assistant_task_guard(), public.assistant_task_audit() from public;
create trigger assistant_task_guard before insert or update on public.assistant_tasks for each row execute function public.assistant_task_guard();
create trigger assistant_task_audit after insert or update on public.assistant_tasks for each row execute function public.assistant_task_audit();

create table public.assistant_task_feedback (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
 task_id uuid not null references public.assistant_tasks(id) on delete cascade,
 category text not null check(category in ('wrong_recipient','not_relevant','missed_task','draft_edited','useful')),
 note text not null check(length(note) between 3 and 1000), created_at timestamptz not null default now()
);
create index assistant_feedback_owner on public.assistant_task_feedback(owner_id,created_at desc);
alter table public.assistant_task_feedback enable row level security;
revoke all on public.assistant_task_feedback from anon,authenticated;
grant select,insert on public.assistant_task_feedback to authenticated;
create policy assistant_feedback_read on public.assistant_task_feedback for select to authenticated using(owner_id=(select auth.uid()) and (select auth.jwt()->>'aal')='aal2');
create policy assistant_feedback_insert on public.assistant_task_feedback for insert to authenticated with check(owner_id=(select auth.uid()) and (select auth.jwt()->>'aal')='aal2' and exists(select 1 from public.assistant_tasks t where t.id=task_id and t.owner_id=(select auth.uid())));
