-- Long-lived personal bearer credentials for a private ChatGPT MCP connection.
-- Only a SHA-256 hash is retained; browser roles have no access to this table.

create table if not exists public.solvani_mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  fingerprint text not null check (char_length(fingerprint) between 6 and 16),
  scope text not null check (char_length(scope) between 1 and 256),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index if not exists solvani_mcp_tokens_owner_active_idx
  on public.solvani_mcp_tokens (owner_id, created_at desc)
  where revoked_at is null;
create index if not exists solvani_mcp_tokens_expiry_idx
  on public.solvani_mcp_tokens (expires_at);

alter table public.solvani_mcp_tokens enable row level security;
revoke all on table public.solvani_mcp_tokens from anon, authenticated;
grant all on table public.solvani_mcp_tokens to service_role;
