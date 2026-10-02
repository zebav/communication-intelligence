-- OAuth 2.1 credentials used only by Solvani's server-side MCP endpoint.
-- Browser clients have no grants or RLS policies for these sensitive tables.

create table if not exists public.solvani_oauth_codes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null unique check (char_length(code_hash) = 64),
  client_id text not null check (char_length(client_id) between 1 and 2048),
  redirect_uri text not null check (char_length(redirect_uri) between 1 and 4096),
  code_challenge text not null check (char_length(code_challenge) between 43 and 128),
  scope text not null check (char_length(scope) between 1 and 256),
  resource text not null check (char_length(resource) between 1 and 2048),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index if not exists solvani_oauth_codes_expiry_idx
  on public.solvani_oauth_codes (expires_at);

create table if not exists public.solvani_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  access_token_hash text not null unique check (char_length(access_token_hash) = 64),
  refresh_token_hash text not null unique check (char_length(refresh_token_hash) = 64),
  client_id text not null check (char_length(client_id) between 1 and 2048),
  scope text not null check (char_length(scope) between 1 and 256),
  resource text not null check (char_length(resource) between 1 and 2048),
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (access_expires_at <= refresh_expires_at)
);

create index if not exists solvani_oauth_tokens_owner_idx
  on public.solvani_oauth_tokens (owner_id, updated_at desc);
create index if not exists solvani_oauth_tokens_refresh_expiry_idx
  on public.solvani_oauth_tokens (refresh_expires_at);

alter table public.solvani_oauth_codes enable row level security;
alter table public.solvani_oauth_tokens enable row level security;

revoke all on table public.solvani_oauth_codes from anon, authenticated;
revoke all on table public.solvani_oauth_tokens from anon, authenticated;
grant all on table public.solvani_oauth_codes to service_role;
grant all on table public.solvani_oauth_tokens to service_role;
