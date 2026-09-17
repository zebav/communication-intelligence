-- Server-only accounting. No period is seeded: reconcile provider billing before enabling.
create table public.assistant_browser_budget (
  id boolean primary key default true check (id),
  period_start timestamptz not null,
  period_end timestamptz not null check (period_end > period_start),
  browser_seconds bigint not null default 0 check (browser_seconds between 0 and 324000),
  ai_micro_usd bigint not null default 0 check (ai_micro_usd between 0 and 10000000),
  enabled boolean not null default false
);
create table public.assistant_browser_reservations (
  request_id uuid primary key,
  created_at timestamptz not null default now(),
  period_start timestamptz not null,
  ai_micro_usd bigint not null check (ai_micro_usd between 0 and 10000000),
  session_id text unique,
  state text not null default 'reserved' check (state in ('reserved','running','uncertain','closed'))
);
-- Global single-session lock, including ambiguous starts. No automatic expiry unlocks it.
create unique index assistant_browser_one_active on public.assistant_browser_reservations ((true)) where state <> 'closed';
alter table public.assistant_browser_budget enable row level security;
alter table public.assistant_browser_reservations enable row level security;
revoke all on public.assistant_browser_budget, public.assistant_browser_reservations from public, anon, authenticated;
grant select, insert, update on public.assistant_browser_budget, public.assistant_browser_reservations to service_role;

create function public.assistant_reserve_browser(p_request_id uuid, p_ai_micro_usd bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare b public.assistant_browser_budget;
begin
  if p_request_id is null or p_ai_micro_usd is null or p_ai_micro_usd < 0 or p_ai_micro_usd > 10000000 then
    raise exception 'Invalid reservation';
  end if;
  select * into b from public.assistant_browser_budget where id = true for update;
  if not found then raise exception 'Budget not configured'; end if;
  if not b.enabled or now() < b.period_start or now() + interval '5 minutes' >= b.period_end then
    raise exception 'Budget disabled or period requires reconciliation';
  end if;
  if b.browser_seconds > 324000 - 300 or b.ai_micro_usd > 10000000 - p_ai_micro_usd then
    raise exception 'Budget exhausted';
  end if;
  -- Duplicate request and active-session conflicts roll back the complete transaction.
  insert into public.assistant_browser_reservations(request_id, period_start, ai_micro_usd)
    values (p_request_id, b.period_start, p_ai_micro_usd);
  update public.assistant_browser_budget set browser_seconds = browser_seconds + 300,
    ai_micro_usd = ai_micro_usd + p_ai_micro_usd where id = true;
end;
$$;
revoke all on function public.assistant_reserve_browser(uuid,bigint) from public, anon, authenticated;
grant execute on function public.assistant_reserve_browser(uuid,bigint) to service_role;

comment on table public.assistant_browser_reservations is 'Never close an ambiguous reservation or refund usage automatically. Close only after provider termination is verified. Retain full reserved cost.';
