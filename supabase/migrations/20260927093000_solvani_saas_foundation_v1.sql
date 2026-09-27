-- Solvani SaaS Foundation V1. Payment processors remain deliberately disconnected.
do $$ begin
  create type public.solvani_plan_code as enum ('private_beta', 'starter', 'pro', 'concierge');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.solvani_entitlement_status as enum ('trialing', 'active', 'paused', 'past_due', 'canceled');
exception when duplicate_object then null;
end $$;

create table if not exists public.account_entitlements (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  plan_code public.solvani_plan_code not null default 'private_beta',
  status public.solvani_entitlement_status not null default 'active',
  limits jsonb not null default '{}'::jsonb,
  trial_ends_at timestamptz,
  current_period_ends_at timestamptz,
  billing_provider text,
  billing_customer_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_entitlements_billing_provider_check check (billing_provider is null or billing_provider in ('apple', 'stripe'))
);

create table if not exists public.assistant_usage_ledger (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  metric text not null check (metric in ('ai_credits', 'browser_minutes', 'maps_requests', 'storage_bytes')),
  quantity numeric(14, 3) not null check (quantity >= 0),
  occurred_at timestamptz not null default now(),
  reference_type text,
  reference_id text,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists assistant_usage_ledger_owner_metric_time_idx on public.assistant_usage_ledger(owner_id, metric, occurred_at desc);

alter table public.account_entitlements enable row level security;
alter table public.assistant_usage_ledger enable row level security;
revoke all on public.account_entitlements from public, anon;
revoke all on public.assistant_usage_ledger from public, anon;
grant select on public.account_entitlements to authenticated;
grant select on public.assistant_usage_ledger to authenticated;

drop policy if exists account_entitlements_owner_read on public.account_entitlements;
create policy account_entitlements_owner_read on public.account_entitlements for select to authenticated
  using (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2');
drop policy if exists assistant_usage_ledger_owner_read on public.assistant_usage_ledger;
create policy assistant_usage_ledger_owner_read on public.assistant_usage_ledger for select to authenticated
  using (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2');

insert into public.account_entitlements (owner_id)
select id from public.profiles
on conflict (owner_id) do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, 'Owner'), '@', 1)),
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;
  insert into public.account_entitlements (owner_id)
  values (new.id)
  on conflict (owner_id) do nothing;
  return new;
end;
$$;

comment on table public.account_entitlements is 'Entitlements only. Changes are server-side or billing-webhook controlled; no client writes.';
comment on table public.assistant_usage_ledger is 'Append-only service-side usage accounting. Never trust client supplied quantities.';
