-- Server-only approvals; no approvals seeded and no execution enabled.
create table public.assistant_browser_approvals (
 id uuid primary key,
 owner_id uuid not null references public.profiles(id),
 task_id uuid not null references public.assistant_tasks(id),
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 consumed_at timestamptz,
 check(payload->>'id'=id::text),
 check(payload->>'ownerId'=owner_id::text),
 check(payload->>'taskId'=task_id::text)
);
create index assistant_browser_approvals_task on public.assistant_browser_approvals(task_id);
create index assistant_browser_approvals_owner on public.assistant_browser_approvals(owner_id);
alter table public.assistant_browser_approvals enable row level security;
revoke all on public.assistant_browser_approvals from public,anon,authenticated;
grant select,insert,update on public.assistant_browser_approvals to service_role;
grant select,update on public.assistant_tasks to service_role;
grant insert on public.assistant_task_events to service_role;
grant select on public.messages to service_role;

create function public.assistant_claim_browser_approval(p_payload jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare t public.assistant_tasks; a public.assistant_browser_approvals;
begin
 -- Consistent lock order: task before approval; never hold locks during network calls.
 select * into t from public.assistant_tasks where id=(p_payload->>'taskId')::uuid for update;
 if not found or t.owner_id::text is distinct from p_payload->>'ownerId'
   or t.kind<>'website' or t.status<>'ready'
   or t.revision is distinct from (p_payload->>'revision')::integer then return false; end if;
 select * into a from public.assistant_browser_approvals where id=(p_payload->>'id')::uuid for update;
 if not found or a.consumed_at is not null or a.payload is distinct from p_payload
   or a.owner_id<>t.owner_id or a.task_id<>t.id
   or p_payload->>'status' is distinct from 'approved'
   or p_payload->>'mode' is distinct from 'read_only'
   or (p_payload->>'approvedAt')::timestamptz is null
   or (p_payload->>'expiresAt')::timestamptz is null
   or (p_payload->>'approvedAt')::timestamptz>clock_timestamp()
   or (p_payload->>'expiresAt')::timestamptz<=clock_timestamp()
 then return false; end if;
 update public.assistant_browser_approvals set consumed_at=clock_timestamp() where id=a.id;
 update public.assistant_tasks set status='executing' where id=t.id;
 return true;
end $$;
revoke all on function public.assistant_claim_browser_approval(jsonb) from public,anon,authenticated;
grant execute on function public.assistant_claim_browser_approval(jsonb) to service_role;

-- Explicit review saves exactly one URL, never a domain-wide grant or subresources.
create function public.assistant_prepare_browser_approval(p_owner_id uuid, p_task_id uuid, p_revision integer, p_target_url text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.assistant_tasks; approval jsonb; approval_id uuid := gen_random_uuid(); reviewed_at timestamptz;
begin
 select * into t from public.assistant_tasks where id=p_task_id for update;
 if not found or t.owner_id is distinct from p_owner_id or t.kind<>'website'
   or t.status not in ('decision','ready') or t.revision is distinct from p_revision
   or p_target_url is null or length(p_target_url)>4096
   or p_target_url !~ '^https://[^/@[:space:]]+(/|$)'
   or t.plan #>> '{evidence,analysis,actionSuggestion,targetUrl}' is distinct from p_target_url
 then raise exception 'Review the current task and exact URL again'; end if;
 -- The revision increment invalidates every previously issued approval for this task.
 update public.assistant_tasks set status='ready' where id=t.id returning * into t;
 reviewed_at := clock_timestamp();
 approval := jsonb_build_object('id',approval_id,'ownerId',t.owner_id,'taskId',t.id,
   'revision',t.revision,'mode','read_only','status','approved','targetUrl',p_target_url,
   'approvedUrls',jsonb_build_array(p_target_url),'approvedAt',reviewed_at,'expiresAt',reviewed_at+interval '5 minutes');
 insert into public.assistant_browser_approvals(id,owner_id,task_id,payload) values(approval_id,t.owner_id,t.id,approval);
 return approval;
end $$;
revoke all on function public.assistant_prepare_browser_approval(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.assistant_prepare_browser_approval(uuid,uuid,integer,text) to service_role;
