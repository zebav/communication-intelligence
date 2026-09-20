create type public.knowledge_sensitivity as enum ('standard','personal','sensitive','restricted');
create type public.contact_point_kind as enum ('email','phone','url');

create table public.personal_knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (char_length(category) between 1 and 80),
  key text not null check (char_length(key) between 1 and 120),
  encrypted_value text not null,
  sensitivity public.knowledge_sensitivity not null default 'personal',
  source text not null default 'owner',
  allowed_uses text[] not null default '{}',
  verified_at timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, category, key)
);

create table public.person_contact_points (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  kind public.contact_point_kind not null,
  value text not null,
  normalized_value text not null,
  label text,
  source_provider text,
  source_connection_id uuid references public.connections(id) on delete set null,
  verified boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, kind, normalized_value)
);

create table public.external_contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.connections(id) on delete cascade,
  provider text not null,
  provider_contact_id text not null,
  person_id uuid not null references public.people(id) on delete cascade,
  display_name text,
  etag text,
  raw_metadata jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, connection_id, provider_contact_id)
);

create index personal_knowledge_owner_category_idx on public.personal_knowledge_entries(owner_id, category);
create index person_contact_points_person_idx on public.person_contact_points(owner_id, person_id);
create index external_contacts_person_idx on public.external_contacts(owner_id, person_id);

alter table public.personal_knowledge_entries enable row level security;
alter table public.person_contact_points enable row level security;
alter table public.external_contacts enable row level security;

revoke all on public.personal_knowledge_entries from anon, authenticated;
revoke all on public.person_contact_points from anon;
revoke all on public.external_contacts from anon;

grant select on public.person_contact_points to authenticated;
grant select on public.external_contacts to authenticated;

create policy person_contact_points_owner_select on public.person_contact_points
  for select to authenticated
  using (owner_id = (select auth.uid()) and (select auth.jwt()->>'aal') = 'aal2');

create policy external_contacts_owner_select on public.external_contacts
  for select to authenticated
  using (owner_id = (select auth.uid()) and (select auth.jwt()->>'aal') = 'aal2');

grant all on public.personal_knowledge_entries to service_role;
grant all on public.person_contact_points to service_role;
grant all on public.external_contacts to service_role;
