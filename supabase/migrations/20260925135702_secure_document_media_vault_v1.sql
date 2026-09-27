-- Reconciled from the production schema. Raw objects remain private and are
-- written by server-side provider workers only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'secure-vault', 'secure-vault', false, 104857600,
  array[
    'application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif',
    'text/plain','text/csv','application/json',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do nothing;

create table if not exists public.vault_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  asset_kind text not null check (asset_kind in ('document','person_image','image','other')),
  retention_status text not null default 'candidate' check (retention_status in ('candidate','saved','rejected')),
  title text not null default '', filename text not null, mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0 and size_bytes <= 104857600),
  storage_bucket text not null default 'secure-vault', storage_path text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  sensitivity text not null default 'personal' check (sensitivity in ('standard','personal','sensitive','restricted')),
  document_type text, summary text not null default '', retention_reason text not null default '',
  importance_score numeric not null default 0 check (importance_score >= 0 and importance_score <= 1),
  reusable boolean not null default false, source_type text not null check (source_type in ('email','whatsapp','instagram','chatgpt_upload','google_photos','manual','other')),
  source_attachment_id uuid references public.attachments(id) on delete set null,
  source_message_id uuid references public.messages(id) on delete set null,
  source_conversation_id uuid references public.conversations(id) on delete set null,
  source_person_id uuid references public.people(id) on delete set null,
  ai_decision jsonb not null default '{}'::jsonb, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(owner_id, sha256)
);
create index if not exists vault_assets_owner_status_idx on public.vault_assets(owner_id, retention_status, created_at desc);
create index if not exists vault_assets_message_idx on public.vault_assets(owner_id, source_message_id) where source_message_id is not null;
create index if not exists vault_assets_owner_person_idx on public.vault_assets(owner_id, source_person_id) where source_person_id is not null;

create table if not exists public.person_media (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  asset_id uuid not null references public.vault_assets(id) on delete cascade,
  role text not null default 'reference' check (role in ('avatar','reference','conversation_screenshot','photo')),
  match_method text not null default 'manual' check (match_method in ('manual','conversation_context','contact_source','google_photos','ai_suggested')),
  confidence numeric check (confidence >= 0 and confidence <= 1), user_verified boolean not null default false,
  created_at timestamptz not null default now(), unique(owner_id, person_id, asset_id)
);
create unique index if not exists person_media_one_avatar_idx on public.person_media(owner_id, person_id) where role = 'avatar';

create table if not exists public.vault_ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid references public.connections(id) on delete cascade,
  provider text not null, source_type text not null check (source_type in ('email','whatsapp','instagram','manual','other')),
  provider_message_id text not null, source_message_id uuid references public.messages(id) on delete cascade,
  source_conversation_id uuid references public.conversations(id) on delete cascade,
  source_person_id uuid references public.people(id) on delete set null,
  message_text text not null default '', state text not null default 'pending' check (state in ('pending','processing','done','failed')),
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 10), last_error_code text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(owner_id, provider, connection_id, provider_message_id)
);
create index if not exists vault_ingestion_jobs_pending_idx on public.vault_ingestion_jobs(owner_id, state, created_at);

alter table public.vault_assets enable row level security;
alter table public.person_media enable row level security;
alter table public.vault_ingestion_jobs enable row level security;

drop policy if exists vault_assets_owner_select on public.vault_assets;
create policy vault_assets_owner_select on public.vault_assets for select to authenticated
using (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2');
drop policy if exists person_media_owner_select on public.person_media;
create policy person_media_owner_select on public.person_media for select to authenticated
using (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2');

