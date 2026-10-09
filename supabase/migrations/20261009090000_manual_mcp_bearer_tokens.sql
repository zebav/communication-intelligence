-- Personal bearer credentials for the owner's manually configured ChatGPT MCP.
-- Tokens are always stored as SHA-256 hashes. Browser clients have no grants.

create table if not exists public.solvani_mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  token_fingerprint text not null check (char_length(token_fingerprint) between 6 and 8),
  scope text not null check (char_length(scope) between 1 and 256),
  resource text not null check (resource = 'https://www.solvani.app/api/mcp'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  check (expires_at > created_at)
);

create index if not exists solvani_mcp_tokens_owner_created_idx
  on public.solvani_mcp_tokens (owner_id, created_at desc);
create index if not exists solvani_mcp_tokens_active_lookup_idx
  on public.solvani_mcp_tokens (token_hash)
  where revoked_at is null;

alter table public.solvani_mcp_tokens enable row level security;

-- The authenticated browser only reaches these rows through MFA-protected
-- server routes. Keeping the table service-role-only prevents token metadata
-- from becoming a future client-side data API by accident.
revoke all on table public.solvani_mcp_tokens from anon, authenticated;
grant all on table public.solvani_mcp_tokens to service_role;

-- This explicit policy documents that only trusted server-side service-role
-- operations may access token metadata. The service role key must never be
-- exposed to the browser.
create policy "service role manages manual mcp tokens"
  on public.solvani_mcp_tokens
  for all
  to service_role
  using (true)
  with check (true);
