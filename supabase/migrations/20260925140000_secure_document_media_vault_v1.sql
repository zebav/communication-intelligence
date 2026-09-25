-- Secure Document & Media Vault V1
create table if not exists public.vault_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  asset_kind text not null check (asset_kind in ('document','person_image','image','other')),
  retention_status text not null default 'candidate' check (retention_status in ('candidate','saved','rejected')),
  title text not null default '',
  filename text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0 and size_bytes <= 104857600),
  storage_bucket text not null default 'secure-vault',
  storage_path text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  sensitivity text not null default 'personal' check (sensitivity in ('standard','personal','sensitive','restricted')),
  document_type text,
  summary text not null default '',
  retention_reason text not null default '',
  importance_score numeric(4,3) not null default 0 check (importance_score between 0 and 1),
  reusable boolean not null default false,
  source_type text not null check (source_type in ('email','whatsapp','instagram','chatgpt_upload','google_photos','manual','other')),
  source_attachment_id uuid references public.attachments(id) on delete set null,
  source_message_id uuid references public.messages(id) on delete set null,
  source_conversation_id uuid references public.conversations(id) on delete set null,
  source_person_id uuid references public.people(id) on delete set null,
  ai_decision jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, sha256)
);

create index if not exists vault_assets_owner_status_idx on public.vault_assets(owner_id, retention_status, created_at desc);
create index if not exists vault_assets_owner_person_idx on public.vault_assets(owner_id, source_person_id) where source_person_id is not null;
create index if not exists vault_assets_message_idx on public.vault_assets(owner_id, source_message_id) where source_message_id is not null;

create table if not exists public.vault_asset_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid not null references public.vault_assets(id) on delete cascade,
  link_type text not null check (link_type in ('person','message','conversation','assistant_task','calendar_event','company','other')),
  linked_id uuid not null,
  role text not null default 'related',
  confidence numeric(4,3) check (confidence between 0 and 1),
  user_verified boolean not null default false,
  source text not null default 'system',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(owner_id, asset_id, link_type, linked_id, role)
);

create index if not exists vault_asset_links_lookup_idx on public.vault_asset_links(owner_id, link_type, linked_id);

create table if not exists public.person_media (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  asset_id uuid not null references public.vault_assets(id) on delete cascade,
  role text not null default 'reference' check (role in ('avatar','reference','conversation_screenshot','photo')),
  match_method text not null default 'manual' check (match_method in ('manual','conversation_context','contact_source','google_photos','ai_suggested')),
  confidence numeric(4,3) check (confidence between 0 and 1),
  user_verified boolean not null default false,
  created_at timestamptz not null default now(),
  unique(owner_id, person_id, asset_id)
);

create unique index if not exists person_media_one_avatar_idx on public.person_media(owner_id, person_id) where role='avatar';

alter table public.people add column if not exists avatar_asset_id uuid references public.vault_assets(id) on delete set null;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'secure-vault','secure-vault',false,104857600,
  array[
    'application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif',
    'text/plain','text/csv','application/json',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

alter table public.vault_assets enable row level security;
alter table public.vault_asset_links enable row level security;
alter table public.person_media enable row level security;

revoke all on public.vault_assets, public.vault_asset_links, public.person_media from anon;
grant select on public.vault_assets, public.vault_asset_links, public.person_media to authenticated;
grant all on public.vault_assets, public.vault_asset_links, public.person_media to service_role;

drop policy if exists vault_assets_owner_select on public.vault_assets;
create policy vault_assets_owner_select on public.vault_assets
  for select to authenticated
  using (owner_id = (select auth.uid()) and (select auth.jwt()->>'aal') = 'aal2');

drop policy if exists vault_asset_links_owner_select on public.vault_asset_links;
create policy vault_asset_links_owner_select on public.vault_asset_links
  for select to authenticated
  using (owner_id = (select auth.uid()) and (select auth.jwt()->>'aal') = 'aal2');

drop policy if exists person_media_owner_select on public.person_media;
create policy person_media_owner_select on public.person_media
  for select to authenticated
  using (owner_id = (select auth.uid()) and (select auth.jwt()->>'aal') = 'aal2');

comment on table public.vault_assets is 'Owner-scoped secure reusable documents and media. Binary data is stored in private Supabase Storage.';
comment on table public.person_media is 'Owner-scoped person images linked to Contact/Person Graph. AI suggestions are not verified identities until user_verified=true.';
