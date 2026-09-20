create table if not exists public.assistant_browser_contexts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  host text not null check (host ~ '^[a-z0-9.-]+$' and host !~ '^\\.' and host !~ '\\.$'),
  context_id text not null unique check (length(context_id) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(owner_id, host)
);

create table if not exists public.assistant_browser_agent_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.assistant_tasks(id) on delete cascade,
  execution_revision integer not null check (execution_revision > 0),
  host text not null check (host ~ '^[a-z0-9.-]+$'),
  run_id text not null unique check (length(run_id) between 1 and 200),
  session_id text,
  status text not null check (status in ('PENDING','RUNNING','COMPLETED','FAILED','TIMED_OUT','STOPPED')),
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, task_id, execution_revision)
);

create index if not exists assistant_browser_agent_runs_owner_status
  on public.assistant_browser_agent_runs(owner_id, status, updated_at desc);

alter table public.assistant_browser_contexts enable row level security;
alter table public.assistant_browser_agent_runs enable row level security;

revoke all on public.assistant_browser_contexts, public.assistant_browser_agent_runs from public, anon, authenticated;
grant select, insert, update, delete on public.assistant_browser_contexts, public.assistant_browser_agent_runs to service_role;

comment on table public.assistant_browser_contexts is
  'Server-only mapping from owner + exact website host to an encrypted-at-rest Browserbase Context ID.';
comment on table public.assistant_browser_agent_runs is
  'Server-only Browserbase Agent runs tied to one reviewed assistant task revision.';
