-- Preserve reservation history, but stop obsolete reservations blocking free time.
create function public.complete_calendar_reservations() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.status='completed' and old.status is distinct from new.status and new.kind in ('move','cancel') then
  update public.calendar_holds set status='released'
  where owner_id=new.owner_id and external_event_id=new.event_id and status='confirmed'
   and (new.kind='cancel' or id is distinct from new.hold_id);
 end if;
 return new;
end $$;
revoke all on function public.complete_calendar_reservations() from public,anon;
create trigger complete_calendar_reservations after update on public.calendar_event_actions
for each row execute function public.complete_calendar_reservations();

create or replace function public.finish_calendar_sync(p_account uuid,p_lease uuid,p_source uuid,p_expected_sync timestamptz,
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
  if not found then
   update public.calendar_sync_jobs set lease_token=null,lease_until=null,next_run_at=now()+interval '1 minute' where account_id=p_account;
   return false;
  end if;
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
