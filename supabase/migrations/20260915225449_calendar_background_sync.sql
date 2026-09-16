-- No scheduler is activated by this migration. An authenticated worker must call it.
alter table public.calendar_accounts add column refresh_lease uuid, add column refresh_lease_until timestamptz;
create function public.claim_calendar_refresh(p_owner uuid,p_account uuid,p_token uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 update public.calendar_accounts set refresh_lease=p_token,refresh_lease_until=now()+interval '45 seconds'
 where owner_id=p_owner and id=p_account and (refresh_lease_until is null or refresh_lease_until<now());
 return found;
end $$;
revoke all on function public.claim_calendar_refresh(uuid,uuid,uuid) from public,anon;
grant execute on function public.claim_calendar_refresh(uuid,uuid,uuid) to authenticated,service_role;

create table public.calendar_sync_jobs (
 account_id uuid primary key,owner_id uuid not null,
 next_run_at timestamptz not null default now(), lease_token uuid,lease_until timestamptz,
 last_attempt_at timestamptz,last_success_at timestamptz,failures integer not null default 0 check(failures>=0),
 last_error text,foreign key(owner_id,account_id) references public.calendar_accounts(owner_id,id)
);
create index calendar_sync_jobs_due on public.calendar_sync_jobs(next_run_at);
create index calendar_sync_jobs_owner on public.calendar_sync_jobs(owner_id);
alter table public.calendar_sync_jobs enable row level security;
revoke all on public.calendar_sync_jobs from public,anon,authenticated;
grant select on public.calendar_sync_jobs to authenticated;
grant all on public.calendar_sync_jobs to service_role;
grant select,update on public.calendar_accounts,public.calendar_sources to service_role;
create policy calendar_sync_jobs_owner on public.calendar_sync_jobs for select to authenticated
using((select auth.uid())=owner_id and (select auth.jwt()->>'aal')='aal2');

create function public.claim_calendar_sync() returns setof public.calendar_sync_jobs
language plpgsql security invoker set search_path='' as $$
declare target uuid;
begin
 insert into public.calendar_sync_jobs(owner_id,account_id)
 select distinct owner_id,account_id from public.calendar_sources where enabled on conflict(account_id) do nothing;
 select j.account_id into target from public.calendar_sync_jobs j
 where j.next_run_at<=now() and (j.lease_until is null or j.lease_until<now())
 and exists(select 1 from public.calendar_sources s where s.owner_id=j.owner_id and s.account_id=j.account_id and s.enabled)
 order by j.next_run_at,j.account_id for update skip locked limit 1;
 if target is null then return; end if;
 return query update public.calendar_sync_jobs set lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds',last_attempt_at=now()
 where account_id=target returning *;
end $$;
revoke all on function public.claim_calendar_sync() from public,anon,authenticated;
grant execute on function public.claim_calendar_sync() to service_role;

-- Fenced publication: late workers and stale snapshots can never replace newer data.
create function public.finish_calendar_sync(p_account uuid,p_lease uuid,p_source uuid,p_expected_sync timestamptz,
 p_snapshot jsonb,p_start timestamptz,p_end timestamptz,p_success boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
declare j record; next_due timestamptz;
begin
 select * into j from public.calendar_sync_jobs where account_id=p_account and lease_token=p_lease and lease_until>now() for update;
 if not found then return false; end if;
 if not exists(select 1 from public.calendar_sources where id=p_source and owner_id=j.owner_id and account_id=p_account and enabled) then
  update public.calendar_sync_jobs set lease_token=null,lease_until=null,next_run_at=now()+interval '1 minute' where account_id=p_account;
  return false;
 end if;
 if p_success then
  if jsonb_typeof(p_snapshot)<>'array' or p_start is null or p_end is null or p_end<=p_start then raise exception 'Invalid snapshot'; end if;
  update public.calendar_sources set snapshot=p_snapshot,window_start=p_start,window_end=p_end,synced_at=now(),sync_error=null
  where id=p_source and owner_id=j.owner_id and synced_at is not distinct from p_expected_sync;
  select min(coalesce(synced_at,'epoch'::timestamptz)+interval '15 minutes') into next_due from public.calendar_sources where account_id=p_account and owner_id=j.owner_id and enabled;
  update public.calendar_sync_jobs set lease_token=null,lease_until=null,next_run_at=greatest(now(),next_due),last_success_at=now(),last_error=null,failures=0 where account_id=p_account;
 else
  -- Never erase a last-good snapshot on timeout, refresh failure or malformed pages.
  update public.calendar_sources set sync_error='Bakgrundssynkroniseringen misslyckades. Tidigare data visas.'
  where id=p_source and owner_id=j.owner_id and synced_at is not distinct from p_expected_sync;
  update public.calendar_sync_jobs set lease_token=null,lease_until=null,failures=least(failures+1,20),
    next_run_at=now()+make_interval(secs=>least(3600,60*power(2,least(failures,6)))::integer),
    last_error='Kalendern kunde inte hämtas. Nytt försök är planerat.' where account_id=p_account;
 end if;
 return true;
end $$;
revoke all on function public.finish_calendar_sync(uuid,uuid,uuid,timestamptz,jsonb,timestamptz,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.finish_calendar_sync(uuid,uuid,uuid,timestamptz,jsonb,timestamptz,timestamptz,boolean) to service_role;
