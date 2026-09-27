create table if not exists public.vault_media_references (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid references public.connections(id) on delete cascade,
  source text not null check (source in ('instagram','whatsapp')),
  provider text not null,
  provider_message_id text not null,
  media_type text,
  media_reference text not null,
  mime_type text,
  filename text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(owner_id, source, provider, provider_message_id, media_reference)
);
create index if not exists vault_media_references_message_idx on public.vault_media_references(owner_id,source,provider_message_id);
alter table public.vault_media_references enable row level security;
revoke all on public.vault_media_references from public,anon,authenticated;
grant all on public.vault_media_references to service_role;
comment on table public.vault_media_references is 'Server-only ephemeral provider media references used to fetch secure Vault bytes; never exposed through normalized message metadata.';