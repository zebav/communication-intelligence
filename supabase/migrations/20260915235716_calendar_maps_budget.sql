-- Shared by Preview and Production. Reserve before the provider request, including
-- failed/uncertain requests. Never refund uncertain usage. USD estimate, not invoice.
create table public.calendar_maps_usage (
 period text primary key,
 reserved_units integer not null default 0 check(reserved_units>=0),
 requests integer not null default 0 check(requests>=0)
);
alter table public.calendar_maps_usage enable row level security;
revoke all on public.calendar_maps_usage from public,anon,authenticated;
grant select,insert,update on public.calendar_maps_usage to service_role;
create function public.reserve_calendar_maps(p_kind text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare
 cost integer; month_key text; day_key text; minute_key text;
begin
 cost:=case p_kind when 'places' then 320 when 'route' then 100
   when 'weather' then 2 when 'map' then 70 when 'details' then 50 else null end;
 if cost is null then raise exception 'Unknown Maps operation'; end if;
 perform pg_advisory_xact_lock(7326081901);
 month_key:='month:'||to_char(now() at time zone 'UTC','YYYY-MM');
 day_key:='day:'||to_char(now() at time zone 'UTC','YYYY-MM-DD');
 minute_key:='minute:'||to_char(now() at time zone 'UTC','YYYY-MM-DD HH24:MI');
 insert into public.calendar_maps_usage(period) values(month_key),(day_key),(minute_key) on conflict do nothing;
 -- 10,000 units = USD 1. No free tier/credit assumptions. 5 USD/month,
 -- 1 USD/day, 20 calls/minute, across all owners and both environments.
 if exists(select 1 from public.calendar_maps_usage where
   (period=month_key and reserved_units+cost>50000) or
   (period=day_key and reserved_units+cost>10000) or
   (period=minute_key and requests>=20)) then return false; end if;
 update public.calendar_maps_usage set reserved_units=reserved_units+cost,requests=requests+1
 where period in(month_key,day_key,minute_key);
 return true;
end $$;
revoke all on function public.reserve_calendar_maps(text) from public,anon,authenticated;
grant execute on function public.reserve_calendar_maps(text) to service_role;
