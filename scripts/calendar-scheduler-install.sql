-- Run only after the production endpoint is verified. Installed PAUSED.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create or replace function calendar_private.dispatch_sync() returns bigint
language plpgsql security invoker set search_path='' as $$
declare token text; request_id bigint;
begin
 delete from calendar_private.dispatch_tokens where expires_at<now();
 token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 insert into calendar_private.dispatch_tokens values(sha256(convert_to(token,'UTF8')),now()+interval '2 minutes');
 select net.http_post(
  url:='https://communication-intelligence-blush.vercel.app/api/cron/calendar-sync',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),
  body:='{}'::jsonb,timeout_milliseconds:=55000
 ) into request_id;
 return request_id;
end $$;
revoke all on function calendar_private.dispatch_sync() from public,anon,authenticated,service_role;
select cron.schedule('calendar-sync-minute','* * * * *','select calendar_private.dispatch_sync()');
select cron.alter_job(jobid,active:=false) from cron.job where jobname='calendar-sync-minute';
